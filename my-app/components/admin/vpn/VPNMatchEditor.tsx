import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Search } from "lucide-react";
import type { ImportRecord, ADSearchResult } from "./vpnADMatchTypes";

interface VPNMatchEditorProps {
  selectedRecord: ImportRecord | null;
  adSearchQuery: string;
  onQueryChange: (query: string) => void;
  adSearchResults: ADSearchResult[];
  isSearching: boolean;
  isMatching: boolean;
  matchNotes: string;
  onNotesChange: (notes: string) => void;
  onSearch: () => void;
  onMatch: (username: string) => void;
  onCancel: () => void;
}

export default function VPNMatchEditor({
  selectedRecord,
  adSearchQuery,
  onQueryChange,
  adSearchResults,
  isSearching,
  isMatching,
  matchNotes,
  onNotesChange,
  onSearch,
  onMatch,
  onCancel,
}: VPNMatchEditorProps) {
  return (
    <div className="flex flex-col h-full">
      {selectedRecord ? (
        <Card className="border-2 border-blue-100 flex-1 flex flex-col">
          <CardHeader className="bg-blue-50/50 border-b border-blue-100 py-4">
            <CardTitle className="text-base text-blue-900 flex items-center gap-2">
              <Search className="w-4 h-4" /> Matching VPN User
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 flex-1 flex flex-col gap-6 overflow-y-auto">
            <div className="bg-blue-50/30 border border-blue-100 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-sm font-medium text-muted-foreground">
                  Username
                </span>
                <span className="text-sm font-mono font-semibold text-foreground">
                  {selectedRecord.vpnUsername}
                </span>
              </div>
              {selectedRecord.fullName && (
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    Name
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {selectedRecord.fullName}
                  </span>
                </div>
              )}
              {selectedRecord.email && (
                <div className="flex justify-between">
                  <span className="text-sm font-medium text-muted-foreground">
                    Email
                  </span>
                  <span className="text-sm font-semibold text-foreground">
                    {selectedRecord.email}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Search Active Directory</Label>
                <div className="flex gap-2">
                  <Input
                    disabled={isMatching}
                    value={adSearchQuery}
                    onChange={(e) => onQueryChange(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && onSearch()}
                    placeholder="Enter AD username..."
                    className="flex-1"
                    autoFocus
                  />
                  <Button
                    onClick={onSearch}
                    disabled={isSearching || isMatching}
                  >
                    {isSearching ? "Searching..." : "Search"}
                  </Button>
                </div>
              </div>

              {adSearchResults.length > 0 && (
                <div className="space-y-2">
                  <Label>Search Results</Label>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {adSearchResults.map((result) => (
                      <Card
                        key={result.username}
                        className="border hover:border-blue-300 transition-colors cursor-pointer"
                        onClick={() => {
                          // Optional: auto-select or confirm dialog
                        }}
                      >
                        <CardContent className="p-3 flex items-center justify-between">
                          <div>
                            <div className="font-semibold text-sm">
                              {result.username}
                            </div>
                            {result.displayName && (
                              <div className="text-xs text-muted-foreground">
                                {result.displayName}
                              </div>
                            )}
                            {result.email && (
                              <div className="text-xs text-muted-foreground">
                                {result.email}
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              onMatch(result.username);
                            }}
                            disabled={isMatching}
                            className="bg-green-600 hover:bg-green-700 text-white"
                          >
                            {isMatching ? "Matching..." : "Match"}
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2 mt-auto pt-4">
              <Label>Match Notes (Optional)</Label>
              <Textarea
                disabled={isMatching}
                value={matchNotes}
                onChange={(e) => onNotesChange(e.target.value)}
                placeholder="Add any notes about this match..."
                className="resize-none h-20"
              />
            </div>

            <Button
              variant="outline"
              className="w-full"
              disabled={isMatching}
              onClick={onCancel}
            >
              Cancel Matching
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8 bg-muted/50 border-2 border-dashed border-border rounded-lg text-center">
          <div className="bg-card p-4 rounded-full shadow-sm mb-4">
            <Search className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold text-foreground">
            No Record Selected
          </h3>
          <p className="text-muted-foreground max-w-xs mt-2">
            Select a VPN user from the list on the left to search for their
            Active Directory account.
          </p>
        </div>
      )}
    </div>
  );
}
