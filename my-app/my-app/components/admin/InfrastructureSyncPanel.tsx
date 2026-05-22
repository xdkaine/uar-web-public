'use client';

import { useState, useEffect } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { 
  Database, 
  RotateCw, 
  Play, 
  Eye, 
  AlertTriangle, 
  CheckCircle2, 
  Info,
  ChevronDown,
  ChevronRight,
  ClipboardList
} from "lucide-react";

interface InfrastructureSyncStats {
  totalADAccounts: number;
  newAccessRequests: number;
  newVPNAccounts: number;
  skippedDuplicates: number;
  errors: number;
}

interface InfrastructureSyncStatus {
  id: string;
  status: 'running' | 'completed' | 'failed' | 'partial';
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string;
  totalADAccounts: number;
  autoAssigned: number;
  notes: string | null;
  errorMessage?: string;
  matches?: Array<{
    id: string;
    adUsername: string;
    adDisplayName: string;
    adEmail: string;
    vpnUsername: string | null;
    accessRequestId: string | null;
    matchType: string;
    wasAutoAssigned: boolean;
    notes: string | null;
  }>;
}

interface InfrastructureSyncResult {
  syncId: string;
  status: 'completed' | 'partial' | 'failed';
  stats: InfrastructureSyncStats;
  records: Array<{
    adUsername: string;
    adEmail: string;
    adDisplayName: string;
    action: 'created' | 'skipped_duplicate' | 'error';
    accessRequestId: string | null;
    vpnAccountId: string | null;
    errorMessage?: string;
  }>;
  error?: string;
}

export default function InfrastructureSyncPanel() {
  const [isRunning, setIsRunning] = useState(false);
  const [latestSync, setLatestSync] = useState<InfrastructureSyncStatus | null>(null);
  const [lastResult, setLastResult] = useState<InfrastructureSyncResult | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    fetchLatestSync();
  }, []);

  const showMessage = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 8000);
  };

  const fetchLatestSync = async () => {
    try {
      const response = await fetchWithCsrf('/api/admin/settings/infrastructure-sync?action=status');
      if (!response.ok) throw new Error('Failed to fetch sync status');
      const result = await response.json();
      if (result.success && result.data) {
        setLatestSync(result.data);
      }
    } catch (error) {
      console.error('Error fetching sync status:', error);
    }
  };

  const runSync = async (dryRun = false) => {
    if (isRunning) return;

    const confirmMessage = dryRun
      ? 'Run a dry run to preview what accounts would be synced?'
      : 'This will create AccessRequest and VPNAccount records for all existing AD accounts with @cpp.edu emails. Continue?';

    if (!confirm(confirmMessage)) return;

    setIsRunning(true);
    setLastResult(null);
    showMessage(
      dryRun 
        ? 'Running dry run - no records will be created...' 
        : 'Running infrastructure sync - this may take a few minutes...',
      'info'
    );

    try {
      const response = await fetchWithCsrf('/api/admin/settings/infrastructure-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Sync failed');
      }

      const result = await response.json();

      if (result.success) {
        setLastResult(result.data);
        
        if (dryRun) {
          showMessage(
            `Dry run completed: Found ${result.data.stats.totalADAccounts} AD accounts. ` +
            `Would create ${result.data.stats.newAccessRequests} AccessRequests and ${result.data.stats.newVPNAccounts} VPNAccounts. ` +
            `${result.data.stats.skippedDuplicates} duplicates would be skipped.`,
            'success'
          );
        } else {
          showMessage(
            `Infrastructure sync completed! ` +
            `Created ${result.data.stats.newAccessRequests} AccessRequests and ${result.data.stats.newVPNAccounts} VPNAccounts. ` +
            `Skipped ${result.data.stats.skippedDuplicates} duplicates. ` +
            `${result.data.stats.errors > 0 ? `${result.data.stats.errors} errors occurred.` : ''}`,
            result.data.stats.errors > 0 ? 'info' : 'success'
          );
        }

        // Refresh latest sync status
        await fetchLatestSync();
      } else {
        showMessage(result.error || 'Sync failed', 'error');
      }
    } catch (error) {
      console.error('Sync error:', error);
      showMessage(
        error instanceof Error ? error.message : 'Failed to run infrastructure sync',
        'error'
      );
    } finally {
      setIsRunning(false);
    }
  };

  const getActionBadge = (action: string) => {
    switch (action) {
      case 'created':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-200 border-green-200"><CheckCircle2 className="w-3 h-3 mr-1" /> Created</Badge>;
      case 'skipped_duplicate':
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-200 border-blue-200"><Info className="w-3 h-3 mr-1" /> Skipped</Badge>;
      case 'error':
        return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" /> Error</Badge>;
      default:
        return <Badge variant="outline">{action}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <Alert className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
         <Database className="h-5 w-5 text-purple-600" />
         <AlertDescription>
            <div className="space-y-2 text-sm text-purple-900 mt-1">
               <p className="font-semibold">
                 Automatically sync existing Active Directory accounts into the application database.
               </p>
               <div className="bg-white/50 rounded-lg p-3 space-y-1 text-xs border border-purple-100">
                  <p className="font-medium">Sync Operations:</p>
                  <ul className="list-disc list-inside space-y-0.5 ml-1">
                     <li>Find all AD accounts with @cpp.edu emails</li>
                     <li>Create AccessRequest records (status: approved)</li>
                     <li>Create VPNAccount records in the Limited portal</li>
                     <li>Link records and skip duplicates</li>
                  </ul>
               </div>
               <p className="text-xs text-purple-600 italic flex items-center gap-1">
                 <Info className="w-3 h-3" /> Tip: Run a dry run first to preview changes
               </p>
            </div>
         </AlertDescription>
      </Alert>

      <div className="flex gap-3 flex-wrap">
        <Button
          onClick={() => runSync(false)}
          disabled={isRunning}
          className="bg-purple-600 hover:bg-purple-700 text-white gap-2 shadow-sm"
        >
          {isRunning ? <RotateCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          {isRunning ? 'Running Sync...' : 'Run Sync'}
        </Button>

        <Button
          variant="secondary"
          onClick={() => runSync(true)}
          disabled={isRunning}
          className="gap-2"
        >
          {isRunning ? <RotateCw className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
          Dry Run (Preview)
        </Button>

        <Button
          variant="outline"
          onClick={fetchLatestSync}
          disabled={isRunning}
          className="gap-2 border-purple-200 text-purple-700 hover:bg-purple-50 hover:text-purple-800"
        >
          <RotateCw className="w-4 h-4" /> Refresh Status
        </Button>
      </div>

      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className={message.type === 'success' ? 'bg-green-50 text-green-900 border-green-200' : ''}>
           {message.type === 'error' ? <AlertTriangle className="h-4 w-4" /> : <Info className="h-4 w-4" />}
           <AlertDescription className="font-medium">{message.text}</AlertDescription>
        </Alert>
      )}

      {latestSync && (
        <Card>
           <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Latest Sync Status</CardTitle>
           </CardHeader>
           <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                 <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Status</span>
                    <div className="flex items-center gap-2">
                       <Badge variant={latestSync.status === 'completed' ? 'default' : latestSync.status === 'failed' ? 'destructive' : 'secondary'} 
                              className={latestSync.status === 'completed' ? 'bg-green-500 hover:bg-green-600' : ''}>
                          {latestSync.status.toUpperCase()}
                       </Badge>
                    </div>
                 </div>
                 <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">AD Accounts</span>
                    <p className="text-2xl font-bold">{latestSync.totalADAccounts}</p>
                 </div>
                 <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Created</span>
                    <p className="text-2xl font-bold text-green-600">{latestSync.autoAssigned}</p>
                 </div>
                 <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">Triggered By</span>
                    <p className="text-sm font-medium truncate" title={latestSync.triggeredBy}>{latestSync.triggeredBy}</p>
                 </div>
              </div>
              
              <div className="mt-4 pt-4 border-t text-xs text-muted-foreground grid grid-cols-1 md:grid-cols-2 gap-2">
                 <p><span className="font-semibold">Started:</span> {new Date(latestSync.startedAt).toLocaleString()}</p>
                 {latestSync.completedAt && <p><span className="font-semibold">Completed:</span> {new Date(latestSync.completedAt).toLocaleString()}</p>}
                 {latestSync.notes && <p className="col-span-full"><span className="font-semibold">Notes:</span> {latestSync.notes}</p>}
                 {latestSync.errorMessage && <p className="col-span-full text-red-600"><span className="font-semibold">Error:</span> {latestSync.errorMessage}</p>}
              </div>
           </CardContent>
        </Card>
      )}

      {lastResult && lastResult.records.length > 0 && (
        <Card>
           <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
              <div className="flex items-center gap-2">
                 <ClipboardList className="w-5 h-5 text-muted-foreground" />
                 <CardTitle className="text-base">Sync Results ({lastResult.records.length} accounts)</CardTitle>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowDetails(!showDetails)} className="text-purple-600">
                 {showDetails ? <ChevronDown className="w-4 h-4 mr-1" /> : <ChevronRight className="w-4 h-4 mr-1" />}
                 {showDetails ? 'Hide Details' : 'Show Details'}
              </Button>
           </CardHeader>
           <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                 <div className="bg-green-50 p-3 rounded-lg border border-green-100 flex flex-col items-center">
                    <span className="text-xs text-green-600 font-semibold uppercase">Created</span>
                    <span className="text-xl font-bold text-green-700">{lastResult.records.filter((r) => r.action === 'created').length}</span>
                 </div>
                 <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 flex flex-col items-center">
                    <span className="text-xs text-blue-600 font-semibold uppercase">Skipped</span>
                    <span className="text-xl font-bold text-blue-700">{lastResult.records.filter((r) => r.action === 'skipped_duplicate').length}</span>
                 </div>
                 <div className="bg-red-50 p-3 rounded-lg border border-red-100 flex flex-col items-center">
                    <span className="text-xs text-red-600 font-semibold uppercase">Errors</span>
                    <span className="text-xl font-bold text-red-700">{lastResult.records.filter((r) => r.action === 'error').length}</span>
                 </div>
                 <div className="bg-purple-50 p-3 rounded-lg border border-purple-100 flex flex-col items-center">
                    <span className="text-xs text-purple-600 font-semibold uppercase">Total</span>
                    <span className="text-xl font-bold text-purple-700">{lastResult.records.length}</span>
                 </div>
              </div>

              {showDetails && (
                 <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                    {lastResult.records.map((record, index) => (
                       <div key={index} className="flex items-start justify-between p-3 rounded-lg border bg-muted/30 hover:bg-muted/50 transition-colors">
                          <div className="space-y-1">
                             <div className="flex items-center gap-2">
                                <span className="font-medium text-sm">{record.adDisplayName}</span>
                                {getActionBadge(record.action)}
                             </div>
                             <div className="text-xs text-muted-foreground space-y-0.5">
                                <p>{record.adUsername} • {record.adEmail}</p>
                                {record.accessRequestId && <p>Request ID: <span className="font-mono">{record.accessRequestId}</span></p>}
                                {record.vpnAccountId && <p>VPN ID: <span className="font-mono">{record.vpnAccountId}</span></p>}
                                {record.errorMessage && <p className="text-red-500 font-medium">{record.errorMessage}</p>}
                             </div>
                          </div>
                       </div>
                    ))}
                 </div>
              )}
           </CardContent>
        </Card>
      )}

      <Alert className="bg-yellow-50 border-yellow-200">
         <Info className="h-4 w-4 text-yellow-600" />
         <AlertTitle className="text-yellow-800">Important Notes</AlertTitle>
         <AlertDescription className="text-yellow-700 text-xs mt-1">
            <ul className="list-disc list-inside space-y-0.5">
               <li><strong>Duplicate Prevention:</strong> Existing accounts are automatically skipped</li>
               <li><strong>Limited Portal:</strong> Synced VPN accounts default to the Limited portal group</li>
               <li><strong>Auto-Approved:</strong> AccessRequests are auto-approved for existing AD accounts</li>
               <li><strong>Transaction Safety:</strong> Operations are atomic (all or nothing)</li>
            </ul>
         </AlertDescription>
      </Alert>
    </div>
  );
}
