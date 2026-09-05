"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import AdminPageHeader from "@/components/admin/AdminPageHeader";
import { AdminRoutePage } from "@/components/admin/AdminRoutePage";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { BatchDetailAccountsPanel } from "./BatchDetailAccountsPanel";
import { BatchDetailAuditTrail } from "./BatchDetailAuditTrail";
import { BatchDetailIntegrityNotice } from "./BatchDetailIntegrityNotice";
import { BatchDetailOverview } from "./BatchDetailOverview";
import type {
  AccountFilter,
  BatchAccount,
  BatchAccountCounts,
  BatchDetail,
} from "./BatchDetailTypes";

export type { BatchDetail } from "./BatchDetailTypes";

function getAccountCounts(accounts: BatchAccount[]): BatchAccountCounts {
  return {
    all: accounts.length,
    attention: accounts.filter((account) => account.needsAttention).length,
    ad: accounts.filter((account) => account.accountSystem === "AD").length,
    vpn: accounts.filter((account) => account.accountSystem === "VPN").length,
    issues: accounts.reduce(
      (total, account) => total + account.issues.length,
      0,
    ),
    linkedRequests: accounts.filter(
      (account) => account.accountSystem === "AD" && account.accessRequestId,
    ).length,
    completed: accounts.filter((account) => account.status === "completed")
      .length,
    failed: accounts.filter((account) => account.status === "failed").length,
    rolledBack: accounts.filter((account) => account.status === "rolled_back")
      .length,
    reconciliation: accounts.filter(
      (account) => account.status === "reconciliation_required",
    ).length,
    open: accounts.filter((account) =>
      ["pending", "processing"].includes(account.status),
    ).length,
    other: accounts.filter(
      (account) =>
        ![
          "completed",
          "failed",
          "rolled_back",
          "reconciliation_required",
          "pending",
          "processing",
        ].includes(account.status),
    ).length,
  };
}

function filterAccounts(
  accounts: BatchAccount[],
  accountFilter: AccountFilter,
  query: string,
): BatchAccount[] {
  const normalizedQuery = query.trim().toLowerCase();
  return accounts.filter((account) => {
    const matchesFilter =
      accountFilter === "all" ||
      (accountFilter === "attention" && account.needsAttention) ||
      (accountFilter === "ad" && account.accountSystem === "AD") ||
      (accountFilter === "vpn" && account.accountSystem === "VPN");
    const matchesQuery =
      !normalizedQuery ||
      [
        account.name,
        account.email ?? "",
        account.username,
        account.accessRequestId ?? "",
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    return matchesFilter && matchesQuery;
  });
}

interface BatchDetailClientProps {
  batch: BatchDetail;
}

export default function BatchDetailClient({ batch }: BatchDetailClientProps) {
  const [activeTab, setActiveTab] = useState("accounts");
  const [accountFilter, setAccountFilter] = useState<AccountFilter>("all");
  const [query, setQuery] = useState("");
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(
    new Set(),
  );
  const accountCounts = useMemo(
    () => getAccountCounts(batch.accounts),
    [batch.accounts],
  );
  const visibleAccounts = useMemo(
    () => filterAccounts(batch.accounts, accountFilter, query),
    [accountFilter, batch.accounts, query],
  );

  const toggleExpanded = (accountId: string) => {
    setExpandedAccounts((current) => {
      const next = new Set(current);
      if (next.has(accountId)) next.delete(accountId);
      else next.add(accountId);
      return next;
    });
  };

  return (
    <AdminRoutePage title="Batch account run" tabId="batch" category="batch">
      <AdminPageHeader
        title="Batch account run"
        description={
          batch.description || "No purpose was recorded for this batch."
        }
        actions={
          <Button variant="outline" asChild>
            <Link href="/admin/batch">
              <ArrowLeft /> Back to batches
            </Link>
          </Button>
        }
      />
      <div className="space-y-5">
        <BatchDetailOverview batch={batch} accountCounts={accountCounts} />
        <BatchDetailIntegrityNotice
          batch={batch}
          accountCounts={accountCounts}
        />
        <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-4">
          <TabsList aria-label="Batch detail sections">
            <TabsTrigger value="accounts">
              Accounts ({batch.accounts.length})
            </TabsTrigger>
            <TabsTrigger value="audit">
              Audit trail ({batch.auditLogs.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="accounts">
            <BatchDetailAccountsPanel
              accountCounts={accountCounts}
              accountFilter={accountFilter}
              expandedAccounts={expandedAccounts}
              query={query}
              visibleAccounts={visibleAccounts}
              onAccountFilterChange={setAccountFilter}
              onQueryChange={setQuery}
              onToggleExpanded={toggleExpanded}
            />
          </TabsContent>
          <TabsContent value="audit">
            <BatchDetailAuditTrail auditLogs={batch.auditLogs} />
          </TabsContent>
        </Tabs>
      </div>
    </AdminRoutePage>
  );
}
