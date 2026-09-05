import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { Check, Link } from "lucide-react";
import type { ImportRecord } from "./vpnADMatchTypes";

const getStatusBadge = (status: string) => {
  switch (status) {
    case "matched":
      return <StatusBadge tone="success">Matched</StatusBadge>;
    case "no_match":
      return <StatusBadge tone="danger">No Match</StatusBadge>;
    case "conflict":
      return <StatusBadge tone="critical">Conflict</StatusBadge>;
    default:
      return <StatusBadge tone="warning">Unmatched</StatusBadge>;
  }
};

interface VPNMatchRecordsProps {
  records: ImportRecord[];
  selectedRecordId?: string;
  filterStatus: string;
  isMatching: boolean;
  onFilterStatusChange: (status: string) => void;
  onSelectRecord: (record: ImportRecord) => void;
  onMarkAsNoMatch: (recordId: string) => void;
}

export default function VPNMatchRecords({
  records,
  selectedRecordId,
  filterStatus,
  isMatching,
  onFilterStatusChange,
  onSelectRecord,
  onMarkAsNoMatch,
}: VPNMatchRecordsProps) {
  return (
    <Card className="flex flex-col h-full border-2">
      <CardHeader className="py-3 px-4 border-b bg-muted/50">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Records</CardTitle>
          <div className="w-40">
            <Select value={filterStatus} onValueChange={onFilterStatusChange}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Filter..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Records</SelectItem>
                <SelectItem value="unmatched">Unmatched</SelectItem>
                <SelectItem value="matched">Matched</SelectItem>
                <SelectItem value="no_match">No Match</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-hidden flex flex-col">
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0 z-10 shadow-sm">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[40%]">
                  VPN Username
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[30%]">
                  Status
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[30%]">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {records.map((record) => (
                <tr
                  key={record.id}
                  className={`hover:bg-muted/50 transition-colors ${selectedRecordId === record.id ? "bg-blue-50/80" : ""}`}
                >
                  <td className="px-3 py-2">
                    <div className="font-mono font-semibold text-foreground">
                      {record.vpnUsername}
                    </div>
                    {record.fullName && (
                      <div className="text-xs text-muted-foreground">
                        {record.fullName}
                      </div>
                    )}
                    {record.matchStatus === "matched" && record.adUsername && (
                      <div className="text-xs text-green-600 dark:text-green-400 font-semibold mt-1 flex items-center gap-1">
                        <Link className="w-3 h-3" /> {record.adUsername}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {getStatusBadge(record.matchStatus)}
                  </td>
                  <td className="px-3 py-2">
                    {record.matchStatus === "unmatched" && (
                      <div className="flex gap-2">
                        <Button
                          disabled={isMatching}
                          size="sm"
                          variant={
                            selectedRecordId === record.id
                              ? "default"
                              : "outline"
                          }
                          className="h-7 text-xs px-2"
                          onClick={() => onSelectRecord(record)}
                        >
                          Match
                        </Button>
                        <Button
                          disabled={isMatching}
                          size="sm"
                          variant="ghost"
                          className="h-7 text-xs px-2 text-muted-foreground hover:text-destructive"
                          onClick={() => onMarkAsNoMatch(record.id)}
                        >
                          No Match
                        </Button>
                      </div>
                    )}
                    {record.matchStatus === "matched" && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Check className="w-3 h-3" /> Matched
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="text-center py-8 text-muted-foreground"
                  >
                    No records found matching the filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
