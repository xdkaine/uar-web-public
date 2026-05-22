'use client';

import { useState, useEffect } from 'react';
import { useToast } from '@/hooks/useToast';
import { fetchWithCsrf } from '@/lib/csrf';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Search, X, Link, AlertTriangle } from 'lucide-react';

interface ImportRecord {
  id: string;
  vpnUsername: string;
  fullName?: string;
  email?: string;
  notes?: string;
  matchStatus: string;
  adUsername?: string;
  adDisplayName?: string;
  adEmail?: string;
  adDepartment?: string;
  matchedBy?: string;
  matchedAt?: string;
  matchNotes?: string;
}

interface VPNImport {
  id: string;
  createdAt: string;
  portalType: string;
  fileName: string;
  importedBy: string;
  totalRecords: number;
  matchedRecords: number;
  status: string;
  notes?: string;
  importRecords: ImportRecord[];
}

interface VPNADMatchModalProps {
  importId: string;
  onClose: () => void;
  onComplete: () => void;
}

export default function VPNADMatchModal({ importId, onClose, onComplete }: VPNADMatchModalProps) {
  const [importData, setImportData] = useState<VPNImport | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<ImportRecord | null>(null);
  const [adSearchQuery, setAdSearchQuery] = useState('');
  const [adSearchResults, setAdSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [matchNotes, setMatchNotes] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const { showToast } = useToast();

  useEffect(() => {
    fetchImportData();
  }, [importId]);

  const fetchImportData = async () => {
    try {
      const response = await fetchWithCsrf(`/api/admin/vpn-import/${importId}`);
      if (!response.ok) throw new Error('Failed to fetch import data');
      const result = await response.json();
      setImportData(result.data);
    } catch (error) {
      showToast('Failed to load import data', 'error');
    }
  };

  const searchAD = async () => {
    if (!adSearchQuery.trim()) {
      showToast('Please enter a search query', 'error');
      return;
    }

    setIsSearching(true);
    try {
      const response = await fetchWithCsrf(`/api/admin/ad-search?q=${encodeURIComponent(adSearchQuery)}`);
      if (!response.ok) throw new Error('Search failed');
      const result = await response.json();
      setAdSearchResults(result.data || []);
      
      if (result.data.length === 0) {
        showToast('No AD accounts found', 'info');
      }
    } catch (error) {
      showToast('Failed to search Active Directory', 'error');
    } finally {
      setIsSearching(false);
    }
  };

  const handleMatch = async (adUsername: string) => {
    if (!selectedRecord) return;

    setIsMatching(true);
    try {
      const response = await fetchWithCsrf('/api/admin/vpn-import/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId: selectedRecord.id,
          adUsername,
          matchNotes,
        }),
      });

      if (!response.ok) throw new Error('Failed to match account');

      showToast('Successfully matched to AD account', 'success');
      setMatchNotes('');
      setAdSearchResults([]);
      setAdSearchQuery('');
      setSelectedRecord(null);
      await fetchImportData();
    } catch (error) {
      showToast('Failed to match account', 'error');
    } finally {
      setIsMatching(false);
    }
  };

  const handleMarkAsNoMatch = async (recordId: string) => {
    try {
      const response = await fetchWithCsrf('/api/admin/vpn-import/match', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recordId,
          matchStatus: 'no_match',
          matchNotes: 'No matching AD account found',
        }),
      });

      if (!response.ok) throw new Error('Failed to update status');

      showToast('Marked as no match', 'success');
      await fetchImportData();
    } catch (error) {
      showToast('Failed to update status', 'error');
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'matched':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">Matched</Badge>;
      case 'no_match':
        return <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100 border-red-200">No Match</Badge>;
      case 'conflict':
        return <Badge variant="destructive" className="bg-orange-100 text-orange-800 hover:bg-orange-100 border-orange-200">Conflict</Badge>;
      default:
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-yellow-200">Unmatched</Badge>;
    }
  };

  const filteredRecords = importData?.importRecords.filter(record => {
    if (filterStatus === 'all') return true;
    return record.matchStatus === filterStatus;
  }) || [];

  if (!importData) {
    return (
      <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
           <div className="flex justify-center items-center py-8">
             <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
           </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto w-full">
        <DialogHeader>
          <div className="flex justify-between items-start mr-8">
            <div className="flex-1">
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <Link className="w-5 h-5" />
                Match VPN Users to Active Directory
              </DialogTitle>
              <div className="text-sm text-gray-500 mt-1 flex flex-col gap-1">
                <span>{importData.fileName} - <span className="font-medium">{importData.portalType} Portal</span></span>
                <div className="flex gap-4 mt-2 text-sm">
                  <span className="font-semibold text-gray-700">Total: {importData.totalRecords}</span>
                  <span className="text-green-600 font-semibold flex items-center gap-1"><Check className="w-3 h-3" /> Matched: {importData.matchedRecords}</span>
                  <span className="text-yellow-600 font-semibold flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Unmatched: {importData.totalRecords - importData.matchedRecords}</span>
                </div>
              </div>
              
              <div className="mt-3 max-w-md">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span>Progress</span>
                  <span>{Math.round((importData.matchedRecords / importData.totalRecords) * 100)}%</span>
                </div>
                <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
                  <div 
                    className="bg-green-600 h-full transition-all duration-300 ease-in-out"
                    style={{ width: `${(importData.matchedRecords / importData.totalRecords) * 100}%` }}
                  ></div>
                </div>
              </div>

              {importData.matchedRecords === 0 && (
                <div className="mt-3 bg-blue-50 border border-blue-200 rounded p-2 text-xs text-blue-800 inline-block">
                  💡 <strong>Tip:</strong> Click "Match" next to a VPN username, then search for the corresponding AD account.
                </div>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full min-h-[500px]">
          <Card className="flex flex-col h-full border-2">
            <CardHeader className="py-3 px-4 border-b bg-gray-50/50">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Records</CardTitle>
                <div className="w-40">
                  <Select
                    value={filterStatus}
                    onValueChange={setFilterStatus}
                  >
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
                  <thead className="bg-gray-50 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[40%]">VPN Username</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[30%]">Status</th>
                      <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[30%]">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filteredRecords.map((record) => (
                      <tr 
                        key={record.id}
                        className={`hover:bg-muted/50 transition-colors ${selectedRecord?.id === record.id ? 'bg-blue-50/80' : ''}`}
                      >
                        <td className="px-3 py-2">
                          <div className="font-mono font-semibold text-gray-900">{record.vpnUsername}</div>
                          {record.fullName && (
                            <div className="text-xs text-muted-foreground">{record.fullName}</div>
                          )}
                          {record.matchStatus === 'matched' && record.adUsername && (
                            <div className="text-xs text-green-600 font-semibold mt-1 flex items-center gap-1">
                              <Link className="w-3 h-3" /> {record.adUsername}
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {getStatusBadge(record.matchStatus)}
                        </td>
                        <td className="px-3 py-2">
                          {record.matchStatus === 'unmatched' && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant={selectedRecord?.id === record.id ? "default" : "outline"}
                                className="h-7 text-xs px-2"
                                onClick={() => {
                                  setSelectedRecord(record);
                                  setAdSearchQuery(record.vpnUsername);
                                }}
                              >
                                Match
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs px-2 text-muted-foreground hover:text-destructive"
                                onClick={() => handleMarkAsNoMatch(record.id)}
                              >
                                No Match
                              </Button>
                            </div>
                          )}
                          {record.matchStatus === 'matched' && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <Check className="w-3 h-3" /> Matched
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredRecords.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center py-8 text-muted-foreground">
                          No records found matching the filter.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

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
                      <span className="text-sm font-medium text-gray-500">Username</span>
                      <span className="text-sm font-mono font-semibold text-gray-900">{selectedRecord.vpnUsername}</span>
                    </div>
                    {selectedRecord.fullName && (
                      <div className="flex justify-between">
                        <span className="text-sm font-medium text-gray-500">Name</span>
                        <span className="text-sm font-semibold text-gray-900">{selectedRecord.fullName}</span>
                      </div>
                    )}
                    {selectedRecord.email && (
                      <div className="flex justify-between">
                        <span className="text-sm font-medium text-gray-500">Email</span>
                        <span className="text-sm font-semibold text-gray-900">{selectedRecord.email}</span>
                      </div>
                    )}
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Search Active Directory</Label>
                      <div className="flex gap-2">
                        <Input
                          value={adSearchQuery}
                          onChange={(e) => setAdSearchQuery(e.target.value)}
                          onKeyPress={(e) => e.key === 'Enter' && searchAD()}
                          placeholder="Enter AD username..."
                          className="flex-1"
                          autoFocus
                        />
                        <Button
                          onClick={searchAD}
                          disabled={isSearching}
                        >
                          {isSearching ? 'Searching...' : 'Search'}
                        </Button>
                      </div>
                    </div>

                    {adSearchResults.length > 0 && (
                      <div className="space-y-2">
                        <Label>Search Results</Label>
                        <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                          {adSearchResults.map((result, index) => (
                            <Card 
                              key={index}
                              className="border hover:border-blue-300 transition-colors cursor-pointer"
                              onClick={() => {
                                // Optional: auto-select or confirm dialog
                              }}
                            >
                              <CardContent className="p-3 flex items-center justify-between">
                                <div>
                                  <div className="font-semibold text-sm">{result.username}</div>
                                  {result.displayName && (
                                    <div className="text-xs text-muted-foreground">{result.displayName}</div>
                                  )}
                                  {result.email && (
                                    <div className="text-xs text-muted-foreground">{result.email}</div>
                                  )}
                                </div>
                                <Button
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMatch(result.username);
                                  }}
                                  disabled={isMatching}
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                >
                                  {isMatching ? 'Matching...' : 'Match'}
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
                      value={matchNotes}
                      onChange={(e) => setMatchNotes(e.target.value)}
                      placeholder="Add any notes about this match..."
                      className="resize-none h-20"
                    />
                  </div>

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => {
                      setSelectedRecord(null);
                      setAdSearchResults([]);
                      setAdSearchQuery('');
                      setMatchNotes('');
                    }}
                  >
                    Cancel Matching
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gray-50 border-2 border-dashed border-gray-200 rounded-lg text-center">
                <div className="bg-white p-4 rounded-full shadow-sm mb-4">
                  <Search className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900">No Record Selected</h3>
                <p className="text-gray-500 max-w-xs mt-2">
                  Select a VPN user from the list on the left to search for their Active Directory account.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button 
            onClick={() => {
              onComplete();
              onClose();
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
