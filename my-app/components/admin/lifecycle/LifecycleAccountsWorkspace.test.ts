import { describe, expect, it } from "vitest";

import type { LifecycleAccountInventoryItem } from "@/lib/lifecycle-account-inventory";
import {
  accountHasRequestedState,
  accountMatchesState,
  deletionConfirmationPhrase,
  deletionPlanConfirmationPhrase,
  isBatchBulkDeletionEligible,
  isLifecycleAccountSelectable,
  lifecycleActionAvailability,
  lifecycleEligibilityState,
  lifecycleInterruptionMessage,
  lifecyclePage,
  lifecycleResponseRequiresReconciliation,
  unmanagedDeletionPermissionMessage,
  vpnDeletionConfirmationPhrase,
} from "./lifecycleAccountsWorkspaceUtils";

function vpnAccount(
  overrides: Partial<NonNullable<LifecycleAccountInventoryItem["vpn"]>> = {},
): LifecycleAccountInventoryItem {
  return {
    accountRef: "vpn:person1",
    displayName: "Person One",
    email: "person1@example.test",
    directory: null,
    vpn: {
      id: "vpn-1",
      username: "person1",
      status: "active",
      portalType: "Limited",
      canRestore: true,
      accessRequestId: "request-1",
      relatedAccountCount: 1,
      ...overrides,
    },
    governance: {
      ownerType: "access_request",
      ownerId: "request-1",
      batchAccountItemId: null,
      requestId: "request-1",
      status: "approved",
      provisioningState: "completed",
      bindingPosture: "not_applicable",
    },
  };
}

function governedAdAccount(): LifecycleAccountInventoryItem {
  return {
    accountRef: "ad:person1",
    displayName: "Person One",
    email: "person1@example.test",
    directory: {
      username: "person1",
      dn: "CN=person1,OU=Users,DC=example,DC=test",
      enabled: true,
    },
    vpn: null,
    governance: {
      ownerType: "access_request",
      ownerId: "request-1",
      batchAccountItemId: null,
      requestId: "request-1",
      status: "approved",
      provisioningState: "completed",
      adAccountStatus: "active",
      bindingPosture: "verified",
    },
  };
}

describe("VPN lifecycle eligibility", () => {
  it("uses a VPN-specific destructive confirmation phrase", () => {
    expect(vpnDeletionConfirmationPhrase("person1")).toBe(
      "DELETE VPN RECORD person1",
    );
  });

  it.each([
    ["active", true, false],
    ["pending_faculty", true, false],
    ["disabled", false, false],
    ["revoked", false, true],
  ])("maps %s to disable=%s and restore=%s", (status, disable, restore) => {
    const account = vpnAccount({ status });

    expect(accountHasRequestedState(account, "disable", "VPN")).toBe(disable);
    expect(accountHasRequestedState(account, "restore", "VPN")).toBe(restore);
  });

  it.each([
    ["Limited", true, false],
    ["Management", false, true],
    ["External", false, false],
  ])("maps %s to promote=%s and demote=%s", (portalType, promote, demote) => {
    const account = vpnAccount({ portalType });

    expect(accountHasRequestedState(account, "promote", "VPN")).toBe(promote);
    expect(accountHasRequestedState(account, "demote", "VPN")).toBe(demote);
  });

  it("does not allow a contradictory VPN/request link to be selected", () => {
    const account = vpnAccount();
    account.governance.bindingPosture = "conflict";

    expect(isLifecycleAccountSelectable(account, "disable", "VPN")).toBe(false);
  });

  it("offers permanent record deletion for independently ready revoked VPN accounts", () => {
    const revoked = vpnAccount({ status: "revoked" });
    const option = {
      actionType: "delete_vpn_record" as const,
      intent: "delete" as const,
      scope: "VPN" as const,
      label: "Permanently delete revoked VPN record",
      description: "Remove the live record and retain its history.",
    };

    expect(lifecycleActionAvailability([revoked], option)).toMatchObject({
      available: true,
      operationMode: "governed",
    });
    expect(
      lifecycleActionAvailability([vpnAccount({ status: "active" })], option),
    ).toMatchObject({
      available: false,
    });
    expect(
      lifecycleActionAvailability(
        [revoked, vpnAccount({ status: "revoked" })],
        option,
      ),
    ).toMatchObject({
      available: true,
      operationMode: "governed",
    });
  });
});

describe("governed AD eligibility", () => {
  it("uses an explicit destructive verb in the exact deletion confirmation phrase", () => {
    expect(deletionConfirmationPhrase("person1")).toBe("DELETE person1");
  });

  it("shows a unique approved request as ready without a separate AD attribute link", () => {
    expect(
      isLifecycleAccountSelectable(governedAdAccount(), "disable", "AD"),
    ).toBe(true);
    expect(
      lifecycleEligibilityState(governedAdAccount(), "disable", "AD"),
    ).toBe("ready");
  });

  it("requires both systems to need the selected combined action", () => {
    const account = governedAdAccount();
    account.vpn = vpnAccount({ status: "revoked" }).vpn;

    expect(accountHasRequestedState(account, "disable", "BOTH")).toBe(false);
    expect(lifecycleEligibilityState(account, "disable", "BOTH")).toBe(
      "not_applicable",
    );

    account.directory!.enabled = false;
    expect(accountHasRequestedState(account, "restore", "BOTH")).toBe(true);
    expect(lifecycleEligibilityState(account, "restore", "BOTH")).toBe("ready");
  });

  it("requires VPN restore permission for VPN and combined restores", () => {
    const account = governedAdAccount();
    account.directory!.enabled = false;
    account.vpn = vpnAccount({ status: "revoked", canRestore: false }).vpn;

    expect(lifecycleEligibilityState(account, "restore", "VPN")).toBe(
      "attention",
    );
    expect(lifecycleEligibilityState(account, "restore", "BOTH")).toBe(
      "attention",
    );
  });

  it("blocks a combined action when the request owns more than one VPN account", () => {
    const account = governedAdAccount();
    account.vpn = vpnAccount({ relatedAccountCount: 2 }).vpn;

    expect(lifecycleEligibilityState(account, "disable", "BOTH")).toBe(
      "attention",
    );
    expect(isLifecycleAccountSelectable(account, "disable", "BOTH")).toBe(
      false,
    );
  });

  it("separates a genuine no-request exception from a request conflict", () => {
    const account = governedAdAccount();
    account.vpn = vpnAccount().vpn;
    account.governance = {
      ownerType: null,
      ownerId: null,
      batchAccountItemId: null,
      requestId: null,
      status: null,
      provisioningState: null,
      bindingPosture: "missing",
    };

    expect(lifecycleEligibilityState(account, "disable", "AD")).toBe(
      "exception",
    );
    expect(lifecycleEligibilityState(account, "disable", "BOTH")).toBe(
      "attention",
    );
  });

  it("routes conflicting request evidence to review instead of calling it missing", () => {
    const account = governedAdAccount();
    account.governance.bindingPosture = "conflict";

    expect(lifecycleEligibilityState(account, "disable", "AD")).toBe(
      "attention",
    );
    expect(isLifecycleAccountSelectable(account, "disable", "AD")).toBe(false);
  });

  it("offers permanent deletion only after the governed AD account is disabled", () => {
    const account = governedAdAccount();
    expect(accountHasRequestedState(account, "delete", "AD")).toBe(false);
    expect(lifecycleEligibilityState(account, "delete", "AD")).toBe(
      "not_applicable",
    );

    account.directory!.enabled = false;
    account.governance.adAccountStatus = "disabled";
    expect(accountHasRequestedState(account, "delete", "AD")).toBe(true);
    expect(lifecycleEligibilityState(account, "delete", "AD")).toBe("ready");

    account.governance.bindingPosture = "missing";
    expect(lifecycleEligibilityState(account, "delete", "AD")).toBe(
      "exception",
    );
  });

  it("does not offer deletion when AD is disabled but the portal record is still active", () => {
    const account = governedAdAccount();
    account.directory!.enabled = false;

    expect(accountHasRequestedState(account, "delete", "AD")).toBe(false);
    expect(lifecycleEligibilityState(account, "delete", "AD")).toBe(
      "not_applicable",
    );
  });

  it("treats a disabled unowned directory account as an explicit deletion exception", () => {
    const account = governedAdAccount();
    account.directory!.enabled = false;
    account.governance = {
      ownerType: null,
      ownerId: null,
      batchAccountItemId: null,
      requestId: null,
      status: null,
      provisioningState: null,
      bindingPosture: "missing",
    };

    expect(accountHasRequestedState(account, "delete", "AD")).toBe(true);
    expect(lifecycleEligibilityState(account, "delete", "AD")).toBe(
      "exception",
    );
  });

  it("describes the separate unmanaged-delete permission set for a disabled unowned account", () => {
    const account = governedAdAccount();
    account.directory!.enabled = false;
    account.governance = {
      ownerType: null,
      ownerId: null,
      batchAccountItemId: null,
      requestId: null,
      status: null,
      provisioningState: null,
      bindingPosture: "missing",
    };

    expect(
      lifecycleActionAvailability([account], {
        actionType: "delete_ad",
        intent: "delete",
        scope: "AD",
        label: "Permanently delete Active Directory account",
        description: "Remove the selected disabled AD objects.",
      }),
    ).toMatchObject({
      available: true,
      operationMode: "directory_override",
      reason:
        "Available as an unmanaged-directory deletion plan for one disabled AD account. Requires lifecycle.delete_unmanaged, lifecycle.delete, lifecycle.override, and users.manage; it never creates or links a request.",
    });
  });

  it("explains why an enabled unowned account cannot be permanently deleted", () => {
    const account = governedAdAccount();
    account.governance = {
      ownerType: null,
      ownerId: null,
      batchAccountItemId: null,
      requestId: null,
      status: null,
      provisioningState: null,
      bindingPosture: "missing",
    };

    expect(
      lifecycleActionAvailability([account], {
        actionType: "delete_ad",
        intent: "delete",
        scope: "AD",
        label: "Permanently delete Active Directory account",
        description: "Remove the selected disabled AD objects.",
      }),
    ).toMatchObject({
      available: false,
      reason:
        "Permanent deletion remains unavailable until every selected Active Directory account is disabled. Disable is a separate action; the workflow never combines disable and delete.",
    });
  });
});

describe("ownership-aware inventory filtering", () => {
  it("does not classify an older inventory response as unowned", () => {
    expect(accountMatchesState(governedAdAccount(), "unlinked")).toBe(false);
  });

  it("filters only explicit unowned and review-ready ownership summaries", () => {
    const unowned = {
      ...governedAdAccount(),
      ownership: {
        ownerType: null,
        ownerId: null,
        requestId: null,
        batchItemId: null,
        batchRunId: null,
        readiness: "unowned" as const,
        expectedSystems: null,
        requestHref: null,
        batchHref: null,
      },
    };
    const needsReview = {
      ...governedAdAccount(),
      ownership: {
        ownerType: "access_request" as const,
        ownerId: "request-1",
        requestId: "request-1",
        batchItemId: null,
        batchRunId: null,
        readiness: "needs_review" as const,
        expectedSystems: null,
        requestHref: null,
        batchHref: null,
      },
    };

    expect(accountMatchesState(unowned, "unlinked")).toBe(true);
    expect(accountMatchesState(needsReview, "attention")).toBe(true);
  });
});

describe("unmanaged deletion permissions", () => {
  it("lists the actual missing unmanaged-deletion prerequisites", () => {
    expect(
      unmanagedDeletionPermissionMessage(
        new Set([
          "users.manage",
          "lifecycle.manage",
          "lifecycle.delete_unmanaged",
        ]),
      ),
    ).toBe("Your role is missing: lifecycle.override, lifecycle.delete.");
    expect(
      unmanagedDeletionPermissionMessage(
        new Set([
          "users.manage",
          "lifecycle.manage",
          "lifecycle.override",
          "lifecycle.delete",
          "lifecycle.delete_unmanaged",
        ]),
      ),
    ).toBeNull();
  });
});

describe("selection-first action availability", () => {
  it("offers governed actions only when every selected account supports them", () => {
    const first = governedAdAccount();
    const second = governedAdAccount();
    second.accountRef = "ad:person2";
    second.directory!.username = "person2";

    const available = lifecycleActionAvailability([first, second], {
      actionType: "disable_ad",
      intent: "disable",
      scope: "AD",
      label: "Disable Active Directory",
      description: "Disable sign-in.",
    });
    expect(available).toMatchObject({
      available: true,
      operationMode: "governed",
    });

    second.directory!.enabled = false;
    const mixed = lifecycleActionAvailability([first, second], {
      actionType: "disable_ad",
      intent: "disable",
      scope: "AD",
      label: "Disable Active Directory",
      description: "Disable sign-in.",
    });
    expect(mixed).toMatchObject({ available: false, operationMode: null });
  });

  it("exposes directory repair only for one unowned AD account", () => {
    const unowned = governedAdAccount();
    unowned.governance = {
      ownerType: null,
      ownerId: null,
      batchAccountItemId: null,
      requestId: null,
      status: null,
      provisioningState: null,
      bindingPosture: "missing",
    };
    const action = {
      actionType: "disable_ad" as const,
      intent: "disable" as const,
      scope: "AD" as const,
      label: "Disable Active Directory",
      description: "Disable sign-in.",
    };

    expect(lifecycleActionAvailability([unowned], action)).toMatchObject({
      available: true,
      operationMode: "directory_override",
    });

    const second = { ...unowned, accountRef: "ad:person2" };
    expect(
      lifecycleActionAvailability([unowned, second], action),
    ).toMatchObject({
      available: false,
      operationMode: null,
    });
  });

  it("does not offer repair for conflicting request evidence", () => {
    const conflict = governedAdAccount();
    conflict.governance.bindingPosture = "conflict";

    expect(
      lifecycleActionAvailability([conflict], {
        actionType: "disable_ad",
        intent: "disable",
        scope: "AD",
        label: "Disable Active Directory",
        description: "Disable sign-in.",
      }),
    ).toMatchObject({ available: false, operationMode: null });
  });

  it("allows independently ready request-owned accounts from separate requests", () => {
    const first = governedAdAccount();
    first.directory!.enabled = false;
    first.governance.adAccountStatus = "disabled";
    const second = governedAdAccount();
    second.accountRef = "ad:person2";
    second.directory!.username = "person2";
    second.directory!.enabled = false;
    second.governance.ownerId = "request-2";
    second.governance.requestId = "request-2";
    second.governance.adAccountStatus = "disabled";
    const option = {
      actionType: "delete_ad" as const,
      intent: "delete" as const,
      scope: "AD" as const,
      label: "Permanently delete Active Directory account",
      description: "Permanently delete one disabled account.",
    };

    expect(lifecycleActionAvailability([first], option)).toMatchObject({
      available: true,
      operationMode: "governed",
    });
    expect(lifecycleActionAvailability([first, second], option)).toMatchObject({
      available: true,
      operationMode: "governed",
    });
  });

  it("allows combined cleanup for separately requested accounts after successful offboarding", () => {
    const first = governedAdAccount();
    first.directory!.enabled = false;
    first.governance.status = "offboarded";
    first.governance.adAccountStatus = "disabled";
    first.vpn = vpnAccount({ status: "revoked" }).vpn;

    const second = structuredClone(first);
    second.accountRef = "ad:person2";
    second.directory!.username = "person2";
    second.governance.ownerId = "request-2";
    second.governance.requestId = "request-2";
    second.vpn!.id = "vpn-2";
    second.vpn!.username = "person2";
    second.vpn!.accessRequestId = "request-2";

    expect(
      lifecycleActionAvailability([first, second], {
        actionType: "delete_both_records",
        intent: "delete",
        scope: "BOTH",
        label: "Permanently delete AD and VPN records",
        description: "Delete independently ready records.",
      }),
    ).toMatchObject({ available: true, operationMode: "governed" });
  });

  it("allows multiple disabled directory-only accounts through the separately privileged override path", () => {
    const first = governedAdAccount();
    first.directory!.enabled = false;
    first.governance = {
      ownerType: null,
      ownerId: null,
      batchAccountItemId: null,
      requestId: null,
      status: null,
      provisioningState: null,
      bindingPosture: "missing",
    };
    const second = structuredClone(first);
    second.accountRef = "ad:person2";
    second.directory!.username = "person2";
    const option = {
      actionType: "delete_ad" as const,
      intent: "delete" as const,
      scope: "AD" as const,
      label: "Permanently delete Active Directory account",
      description: "Permanently delete disabled accounts.",
    };

    expect(lifecycleActionAvailability([first, second], option)).toMatchObject({
      available: true,
      operationMode: "directory_override",
    });
  });

  it.each(["batch-1", "batch-2"])("routes disabled batch accounts through batch governance when the second batch is %s", (secondBatchId) => {
    const first = governedAdAccount();
    first.directory!.enabled = false;
    first.governance = {
      ownerType: "batch_account",
      ownerId: "batch-item-1",
      batchAccountItemId: "batch-item-1",
      requestId: null,
      status: "completed",
      provisioningState: "completed",
      adAccountStatus: "disabled",
      bindingPosture: "verified",
    };
    first.batchProvenance = {
      batchId: "batch-1",
      description: "Workshop identities",
      accountTypes: ["AD"],
    };
    const second = structuredClone(first);
    second.accountRef = "ad:person2";
    second.directory!.username = "person2";
    second.governance.ownerId = "batch-item-2";
    second.governance.batchAccountItemId = "batch-item-2";
    second.batchProvenance!.batchId = secondBatchId;
    const option = {
      actionType: "delete_ad" as const,
      intent: "delete" as const,
      scope: "AD" as const,
      label: "Permanently delete Active Directory account",
      description: "Permanently delete disabled accounts.",
    };

    expect(lifecycleActionAvailability([first, second], option)).toMatchObject({
      available: true,
      operationMode: "batch_governed",
    });
  });

  it("does not offer a mixed request and standalone-batch AD plan across batches", () => {
    const first = governedAdAccount();
    first.directory!.enabled = false;
    first.governance.adAccountStatus = "disabled";
    first.batchProvenance = { batchId: "legacy-batch", description: "Legacy", accountTypes: ["AD"] };
    const second = structuredClone(first);
    second.accountRef = "ad:batch-user";
    second.governance = { ...second.governance, ownerType: "batch_account", ownerId: "item-2", batchAccountItemId: "item-2", requestId: null, status: "completed" };
    second.batchProvenance!.batchId = "standalone-batch";
    expect(lifecycleActionAvailability([first, second], {
      actionType: "delete_ad", intent: "delete", scope: "AD", label: "Delete", description: "Delete disabled records.",
    }).available).toBe(false);
  });

  it("offers revoked VPN deletion across creation batches while checking every account", () => {
    const accounts = ["one", "two"].map((name) => {
      const account = vpnAccount({ id: `vpn-${name}`, username: name, status: "revoked", accessRequestId: null });
      account.governance = { ownerType: "batch_account", ownerId: `item-${name}`, batchAccountItemId: `item-${name}`,
        requestId: null, status: "completed", provisioningState: "completed", bindingPosture: "not_applicable" };
      account.batchProvenance = { batchId: `batch-${name}`, description: name, accountTypes: ["VPN"] };
      return account;
    });
    const option = { actionType: "delete_vpn_record" as const, intent: "delete" as const, scope: "VPN" as const, label: "Delete", description: "Delete revoked records." };
    expect(lifecycleActionAvailability(accounts, option)).toMatchObject({ available: true, operationMode: "governed" });
    accounts[1].vpn!.status = "active";
    expect(lifecycleActionAvailability(accounts, option).available).toBe(false);
  });

  it("recognizes BOTH batch items as eligible for either system deletion", () => {
    const first = governedAdAccount();
    first.batchProvenance = {
      batchId: "batch-1",
      description: "Lab service identities",
      accountTypes: ["BOTH"],
    };
    const second = structuredClone(first);
    second.accountRef = "ad:person2";

    expect(isBatchBulkDeletionEligible([first, second], "AD")).toBe(true);
    expect(isBatchBulkDeletionEligible([first, second], "VPN")).toBe(true);
    expect(isBatchBulkDeletionEligible([first, second], "BOTH")).toBe(true);
  });
});

describe("multi-account execution safety", () => {
  it("binds the destructive phrase to both account and record counts", () => {
    expect(deletionPlanConfirmationPhrase(2, 3)).toBe(
      "DELETE 2 ACCOUNTS / 3 RECORDS",
    );
    expect(deletionPlanConfirmationPhrase(1, 1)).toBe(
      "DELETE 1 ACCOUNT / 1 RECORD",
    );
  });
  it("fail-stops from either reconciliation signal returned by the API", () => {
    expect(
      lifecycleResponseRequiresReconciliation({
        processResult: { reconciliationRequired: true },
        action: { status: "failed" },
      }),
    ).toBe(true);
    expect(
      lifecycleResponseRequiresReconciliation({
        processResult: {},
        action: { status: "reconciliation_required" },
      }),
    ).toBe(true);
    expect(
      lifecycleResponseRequiresReconciliation({
        processResult: {},
        action: { status: "completed" },
      }),
    ).toBe(false);
  });

  it("reports completed, uncertain, and untouched targets after an interruption", () => {
    expect(
      lifecycleInterruptionMessage({
        successful: 1,
        knownFailures: 1,
        attempted: 3,
        total: 5,
        error: "Response body was incomplete.",
      }),
    ).toBe(
      "1 completed; 1 known failure; 1 outcome could not be confirmed; 2 not attempted. Response body was incomplete. Review Operations and reconcile the uncertain target before retrying. For an unfinished deletion confirmation, open Interrupted deletions on the Accounts tab.",
    );
  });
});

describe("account inventory pagination", () => {
  it("shows bounded pages and keeps the last page count accurate", () => {
    const accounts = Array.from(
      { length: 61 },
      (_, index) => `account-${index + 1}`,
    );

    expect(lifecyclePage(accounts, 1, 25)).toMatchObject({
      page: 1,
      totalPages: 3,
      start: 1,
      end: 25,
      items: accounts.slice(0, 25),
    });
    expect(lifecyclePage(accounts, 3, 25)).toMatchObject({
      page: 3,
      totalPages: 3,
      start: 51,
      end: 61,
      items: accounts.slice(50),
    });
  });

  it("clamps a stale page after filtering and defaults an unsupported page size", () => {
    expect(lifecyclePage(["one", "two"], 9, 25)).toMatchObject({
      page: 1,
      totalPages: 1,
      start: 1,
      end: 2,
    });
    expect(
      lifecyclePage(
        Array.from({ length: 30 }, (_, index) => index),
        1,
        17,
      ),
    ).toMatchObject({
      totalPages: 2,
      end: 25,
    });
  });
});
