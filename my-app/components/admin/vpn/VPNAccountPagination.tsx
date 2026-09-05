import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { useVPNAccountQuery } from "./useVPNAccountQuery";

type PaginationQuery = Pick<
  ReturnType<typeof useVPNAccountQuery>,
  | "totalPages"
  | "pageSize"
  | "setPageSize"
  | "currentPage"
  | "setCurrentPage"
  | "filteredAndSortedAccounts"
>;

export default function VPNAccountPagination({
  query,
}: {
  query: PaginationQuery;
}) {
  const {
    totalPages,
    pageSize,
    setPageSize,
    currentPage,
    setCurrentPage,
    filteredAndSortedAccounts,
  } = query;
  if (totalPages <= 1) return null;
  return (
    <Card className="p-4">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground font-medium">
            Show:
          </span>
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => {
              setPageSize(Number(value));
              setCurrentPage(1);
            }}
          >
            <SelectTrigger className="w-[70px] h-8">
              <SelectValue placeholder={pageSize} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="10">10</SelectItem>
              <SelectItem value="25">25</SelectItem>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            of {filteredAndSortedAccounts.length} accounts
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
          >
            First
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(currentPage - 1)}
            disabled={currentPage === 1}
          >
            Previous
          </Button>
          <span className="px-4 py-1 text-sm font-medium text-muted-foreground">
            Page {currentPage} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(currentPage + 1)}
            disabled={currentPage === totalPages}
          >
            Next
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
          >
            Last
          </Button>
        </div>

        <div className="text-sm text-muted-foreground">
          Showing {(currentPage - 1) * pageSize + 1} to{" "}
          {Math.min(currentPage * pageSize, filteredAndSortedAccounts.length)}
        </div>
      </div>
    </Card>
  );
}
