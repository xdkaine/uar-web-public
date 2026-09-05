import { describe, expect, it } from "vitest";
import type { LifecycleAccountInventoryItem } from "@/lib/lifecycle-account-inventory";
import { lifecycleActionAvailability } from "./lifecycleAccountsWorkspaceUtils";

function accounts(): LifecycleAccountInventoryItem[] {
  return ["person1", "person2"].map((username) => ({
    accountRef: `ad:${username}`, displayName: username, email: `${username}@example.test`,
    directory: { username, dn: `CN=${username},DC=example,DC=test`, enabled: false },
    vpn: { id: `vpn-${username}`, username, status: "revoked", portalType: "Limited", canRestore: false,
      accessRequestId: `request-${username}`, relatedAccountCount: 1 },
    governance: { ownerType: "access_request", ownerId: `request-${username}`, requestId: `request-${username}`,
      batchAccountItemId: null, status: "offboarded", provisioningState: "succeeded", adAccountStatus: "disabled", bindingPosture: "verified" },
  }));
}

describe("offboarded accounts with separate requests", () => {
  it.each([["delete_ad", "AD"], ["delete_vpn_record", "VPN"], ["delete_both_records", "BOTH"]] as const)(
    "offers %s and checks the state of every target", (actionType, scope) => {
      const selection = accounts();
      const option = { actionType, intent: "delete" as const, scope, label: "Delete", description: "Delete selected records." };
      expect(lifecycleActionAvailability(selection, option)).toMatchObject({ available: true, operationMode: "governed" });
      selection.forEach((account, index) => {
        account.batchProvenance = { batchId: `batch-${index}`, description: "Legacy batch", accountTypes: ["BOTH"] };
      });
      expect(lifecycleActionAvailability(selection, option).available).toBe(true);
      if (scope === "AD") selection[1].directory!.enabled = true;
      else selection[1].vpn!.status = "active";
      expect(lifecycleActionAvailability(selection, option).available).toBe(false);
    },
  );

  it("does not offer deletion when one account has conflicting ownership", () => {
    const selection = accounts();
    selection[1].governance.bindingPosture = "conflict";
    expect(lifecycleActionAvailability(selection, {
      actionType: "delete_both_records", intent: "delete", scope: "BOTH", label: "Delete", description: "Delete records.",
    }).available).toBe(false);
  });

  it("allows independently governed AD and VPN rows to be deleted in separate plans", () => {
    const ad = accounts()[0];
    ad.vpn = null;
    const vpn = accounts()[0];
    vpn.accountRef = 'vpn:person1';
    vpn.directory = null;
    vpn.governance = { ...vpn.governance, ownerId: 'request-vpn', requestId: 'request-vpn', bindingPosture: 'not_applicable' };
    vpn.vpn = { ...vpn.vpn!, accessRequestId: 'request-vpn' };

    expect(lifecycleActionAvailability([ad], {
      actionType: 'delete_ad', intent: 'delete', scope: 'AD', label: 'Delete AD', description: '',
    })).toMatchObject({ available: true, operationMode: 'governed' });
    expect(lifecycleActionAvailability([vpn], {
      actionType: 'delete_vpn_record', intent: 'delete', scope: 'VPN', label: 'Delete VPN', description: '',
    })).toMatchObject({ available: true, operationMode: 'governed' });
    expect(lifecycleActionAvailability([ad, vpn], {
      actionType: 'delete_both_records', intent: 'delete', scope: 'BOTH', label: 'Delete both', description: '',
    }).available).toBe(false);
  });
});
