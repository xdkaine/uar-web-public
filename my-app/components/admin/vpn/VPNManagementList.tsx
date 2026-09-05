import type { ComponentProps } from "react";
import VPNAccountsTable from "./VPNAccountsTable";
import VPNAccountPagination from "./VPNAccountPagination";
import type { useVPNAccountQuery } from "./useVPNAccountQuery";
import type { VPNAccount } from "./vpnManagementTypes";

interface VPNManagementListProps {
  query: Pick<
    ReturnType<typeof useVPNAccountQuery>,
    | "viewMode"
    | "paginatedAccounts"
    | "splitAccounts"
    | "totalPages"
    | "pageSize"
    | "setPageSize"
    | "currentPage"
    | "setCurrentPage"
    | "filteredAndSortedAccounts"
  >;
  tableProps: Omit<
    ComponentProps<typeof VPNAccountsTable>,
    "accounts" | "onToggleAllSelection"
  >;
  toggleTableSelection: (accounts: VPNAccount[], checked: boolean) => void;
}

export default function VPNManagementList({
  query,
  tableProps,
  toggleTableSelection,
}: VPNManagementListProps) {
  const { viewMode, paginatedAccounts, splitAccounts } = query;
  return (
    <>
      {viewMode === "unified" ? (
        <div className="space-y-4">
          <VPNAccountsTable
            {...tableProps}
            accounts={paginatedAccounts}
            onToggleAllSelection={(checked) =>
              toggleTableSelection(paginatedAccounts, checked)
            }
          />

          <VPNAccountPagination query={query} />
        </div>
      ) : (
        <div className="space-y-6">
          <div className="bg-blue-50 dark:bg-blue-950/40 p-4 rounded-lg border-2 border-blue-200 dark:border-blue-900">
            <h2 className="text-xl font-bold mb-4 text-blue-900">
              Internal VPN Accounts
            </h2>
            <VPNAccountsTable
              {...tableProps}
              accounts={splitAccounts.management}
              title="Management Portal"
              titleColor="text-blue-700 dark:text-blue-200"
              onToggleAllSelection={(checked) =>
                toggleTableSelection(splitAccounts.management, checked)
              }
            />
            <VPNAccountsTable
              {...tableProps}
              accounts={splitAccounts.limited}
              title="Limited Portal"
              titleColor="text-purple-700 dark:text-purple-200"
              onToggleAllSelection={(checked) =>
                toggleTableSelection(splitAccounts.limited, checked)
              }
            />
            {splitAccounts.management.length === 0 &&
              splitAccounts.limited.length === 0 && (
                <div className="text-center text-muted-foreground py-8">
                  No internal VPN accounts in current page
                </div>
              )}
          </div>

          <div className="bg-orange-50 dark:bg-orange-950/40 p-4 rounded-lg border-2 border-orange-200 dark:border-orange-900">
            <h2 className="text-xl font-bold mb-4 text-orange-900">
              External VPN Accounts
            </h2>
            <VPNAccountsTable
              {...tableProps}
              accounts={splitAccounts.external}
              title="External Portal"
              titleColor="text-orange-700 dark:text-orange-200"
              onToggleAllSelection={(checked) =>
                toggleTableSelection(splitAccounts.external, checked)
              }
            />
            {splitAccounts.external.length === 0 && (
              <div className="text-center text-muted-foreground py-8">
                No external VPN accounts in current page
              </div>
            )}
          </div>

          <VPNAccountPagination query={query} />
        </div>
      )}
    </>
  );
}
