'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BatchAccount {
  id: string;
  createdAt: string;
  updatedAt: string;
  name: string;
  email: string;
  ldapUsername: string;
  vpnUsername?: string;
  accountExpiresAt?: string;
  isInternal: boolean;
  needsDomainAccount: boolean;
  createAdAccount: boolean;
  createVpnAccount: boolean;
  status: string;
  ldapCreatedAt?: string;
  vpnCreatedAt?: string;
  errorMessage?: string;
  completedAt?: string;
}

interface AuditLog {
  id: string;
  createdAt: string;
  action: string;
  details: string;
  performedBy: string;
  accountName?: string;
  success: boolean;
}

interface BatchDetail {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  description?: string;
  totalAccounts: number;
  successfulAccounts: number;
  failedAccounts: number;
  status: string;
  completedAt?: string;
  linkedTicket?: {
    id: string;
    subject: string;
    status: string;
    category?: string;
    severity?: string;
  };
  accounts: BatchAccount[];
  auditLogs: AuditLog[];
}

interface BatchDetailModalProps {
  batchId: string | null;
  onClose: () => void;
}

export default function BatchDetailModal({ batchId, onClose }: BatchDetailModalProps) {
  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'accounts' | 'audit'>('accounts');

  useEffect(() => {
    const fetchBatchDetails = async () => {
      if (!batchId) return;

      setLoading(true);
      try {
        const response = await fetch(`/api/admin/batch-accounts/${batchId}`);
        const data = await response.json();

        if (response.ok) {
          setBatch(data.batch);
        }
      } catch (error) {
        console.error('Error fetching batch details:', error);
      } finally {
        setLoading(false);
      }
    };

    if (batchId) {
      fetchBatchDetails();
    }
  }, [batchId]);

  if (!batchId) return null;

  const getStatusBadge = (status: string) => {
    const styles = {
      processing: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      partial: 'bg-yellow-100 text-yellow-800',
      skipped: 'bg-gray-100 text-gray-800',
    };

    return (
      <span className={`px-3 py-1 rounded-full text-xs font-semibold ${styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  const getActionBadge = (action: string, success: boolean) => {
    const actionStyles = {
      batch_created: 'bg-blue-100 text-blue-800',
      batch_completed: 'bg-green-100 text-green-800',
      ldap_account_created: 'bg-green-100 text-green-800',
      ldap_account_failed: 'bg-red-100 text-red-800',
      vpn_account_created: 'bg-green-100 text-green-800',
      vpn_account_failed: 'bg-red-100 text-red-800',
      account_processing_failed: 'bg-red-100 text-red-800',
    };

    const style = actionStyles[action as keyof typeof actionStyles] || (success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800');

    return (
      <span className={`px-2 py-1 rounded text-xs font-semibold ${style}`}>
        {action.replace(/_/g, ' ').toUpperCase()}
      </span>
    );
  };

  return (
    <Dialog open={!!batchId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Batch Operation Details</DialogTitle>
        </DialogHeader>
      {loading ? (
        <div className="flex justify-center items-center py-16">
          <div className="text-gray-600 text-lg">Loading batch details...</div>
        </div>
      ) : batch ? (
        <div className="space-y-8">
          <div className="bg-gray-50 rounded-xl p-8 border border-gray-300 shadow-sm">
            <h3 className="text-lg font-bold mb-6 text-gray-800">Batch Summary</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Batch ID</div>
                <div className="font-mono text-sm bg-white px-3 py-2 rounded border border-gray-200">{batch.id}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Created By</div>
                <div className="font-semibold text-base">{batch.createdBy}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Created At</div>
                <div className="text-sm">{new Date(batch.createdAt).toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Completed At</div>
                <div className="text-sm">
                  {batch.completedAt ? new Date(batch.completedAt).toLocaleString() : '—'}
                </div>
              </div>
              <div className="md:col-span-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Description</div>
                <div className="text-base bg-white px-4 py-3 rounded border border-gray-200">{batch.description || '—'}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Status</div>
                <div>{getStatusBadge(batch.status)}</div>
              </div>
            </div>

            {batch.linkedTicket && (
              <div className="mt-6 pt-6 border-t border-gray-300">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Linked Support Ticket</div>
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                  <div className="font-bold text-base mb-2">{batch.linkedTicket.subject}</div>
                  <div className="text-sm text-gray-600 mb-3">Ticket ID: <span className="font-mono">{batch.linkedTicket.id}</span></div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <span className="bg-gray-100 px-3 py-1 rounded-full">
                      Status: <span className="font-semibold">{batch.linkedTicket.status}</span>
                    </span>
                    {batch.linkedTicket.category && (
                      <span className="bg-gray-100 px-3 py-1 rounded-full">
                        Category: <span className="font-semibold">{batch.linkedTicket.category}</span>
                      </span>
                    )}
                    {batch.linkedTicket.severity && (
                      <span className="bg-gray-100 px-3 py-1 rounded-full">
                        Severity: <span className="font-semibold">{batch.linkedTicket.severity}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-gray-300 grid grid-cols-3 gap-6">
              <div className="text-center bg-white rounded-lg p-4 border border-gray-200">
                <div className="text-3xl font-bold text-gray-800">{batch.totalAccounts}</div>
                <div className="text-sm text-gray-600 mt-2 font-semibold">Total Accounts</div>
              </div>
              <div className="text-center bg-white rounded-lg p-4 border border-green-200">
                <div className="text-3xl font-bold text-green-600">{batch.successfulAccounts}</div>
                <div className="text-sm text-gray-600 mt-2 font-semibold">Successful</div>
              </div>
              <div className="text-center bg-white rounded-lg p-4 border border-red-200">
                <div className="text-3xl font-bold text-red-600">{batch.failedAccounts}</div>
                <div className="text-sm text-gray-600 mt-2 font-semibold">Failed</div>
              </div>
            </div>
          </div>

          <div className="border-b-2 border-gray-200">
            <div className="flex gap-4">
              <button
                onClick={() => setActiveTab('accounts')}
                className={`px-4 py-2 font-semibold transition-colors ${
                  activeTab === 'accounts'
                    ? 'border-b-2 border-black text-black'
                    : 'text-gray-600 hover:text-black'
                }`}
              >
                Accounts ({batch.accounts.length})
              </button>
              <button
                onClick={() => setActiveTab('audit')}
                className={`px-4 py-2 font-semibold transition-colors ${
                  activeTab === 'audit'
                    ? 'border-b-2 border-black text-black'
                    : 'text-gray-600 hover:text-black'
                }`}
              >
                Audit Trail ({batch.auditLogs.length})
              </button>
            </div>
          </div>

          {activeTab === 'accounts' && (
            <div className="space-y-5 max-h-[600px] overflow-y-auto pr-2">
              {batch.accounts.map((account) => (
                <div key={account.id} className="bg-white border border-gray-300 rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="font-bold text-xl text-gray-800">{account.name}</div>
                      <div className="text-sm text-gray-600 mt-1">{account.email}</div>
                    </div>
                    <div>{getStatusBadge(account.status)}</div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="bg-gray-50 px-4 py-3 rounded-lg border border-gray-200">
                      <div className="text-xs text-gray-500 mb-1 font-semibold">LDAP Username</div>
                      <div className="font-semibold font-mono text-base">{account.ldapUsername}</div>
                    </div>
                    {account.vpnUsername && (
                      <div className="bg-gray-50 px-4 py-3 rounded-lg border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1 font-semibold">VPN Username</div>
                        <div className="font-semibold font-mono text-base">{account.vpnUsername}</div>
                      </div>
                    )}
                    <div className="bg-gray-50 px-4 py-3 rounded-lg border border-gray-200">
                      <div className="text-xs text-gray-500 mb-1 font-semibold">Account Type</div>
                      <div className="font-semibold text-base">{account.isInternal ? 'Internal' : 'External'}</div>
                    </div>
                    {account.accountExpiresAt && (
                      <div className="bg-gray-50 px-4 py-3 rounded-lg border border-gray-200">
                        <div className="text-xs text-gray-500 mb-1 font-semibold">Expiration Date</div>
                        <div className="font-semibold text-base">{new Date(account.accountExpiresAt).toLocaleString()}</div>
                      </div>
                    )}
                    {account.ldapCreatedAt && (
                      <div className="bg-green-50 px-4 py-3 rounded-lg border border-green-200">
                        <div className="text-xs text-green-700 mb-1 font-semibold">LDAP Created</div>
                        <div className="font-semibold text-base text-green-800">{new Date(account.ldapCreatedAt).toLocaleString()}</div>
                      </div>
                    )}
                    {account.vpnCreatedAt && (
                      <div className="bg-purple-50 px-4 py-3 rounded-lg border border-purple-200">
                        <div className="text-xs text-purple-700 mb-1 font-semibold">VPN Created</div>
                        <div className="font-semibold text-base text-purple-800">{new Date(account.vpnCreatedAt).toLocaleString()}</div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 mt-4">
                    {account.createAdAccount && (
                      <span className="bg-blue-100 text-blue-800 px-3 py-1.5 rounded-full text-xs font-bold">
                        AD Account
                      </span>
                    )}
                    {account.createVpnAccount && (
                      <span className="bg-purple-100 text-purple-800 px-3 py-1.5 rounded-full text-xs font-bold">
                        VPN Account
                      </span>
                    )}
                    {account.needsDomainAccount && (
                      <span className="bg-gray-100 text-gray-800 px-3 py-1.5 rounded-full text-xs font-bold">
                        Domain Required
                      </span>
                    )}
                  </div>

                  {account.errorMessage && (
                    <div className="mt-4 p-4 bg-red-50 border border-red-300 rounded-lg text-sm text-red-900">
                      <div className="font-bold mb-2 flex items-center gap-2">
                        <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        <span>Error Details</span>
                      </div>
                      <div className="ml-6">{account.errorMessage}</div>
                    </div>
                  )}

                  {account.completedAt && (
                    <div className="mt-4 pt-4 border-t border-gray-200 text-sm text-gray-600">
                      <span className="font-semibold">Completed:</span> {new Date(account.completedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {activeTab === 'audit' && (
            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
              {batch.auditLogs.map((log) => (
                <div key={log.id} className="bg-white border border-gray-300 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
                  <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-3 mb-4">
                    <div className="flex items-center gap-3 flex-wrap">
                      {getActionBadge(log.action, log.success)}
                      <span className="text-sm text-gray-500 font-medium">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <div className="text-sm bg-gray-100 px-3 py-1.5 rounded-full">
                      <span className="text-gray-600">By:</span>{' '}
                      <span className="font-semibold text-gray-800">{log.performedBy}</span>
                    </div>
                  </div>

                  {log.accountName && (
                    <div className="mb-3 bg-gray-50 px-4 py-2 rounded-lg border border-gray-200">
                      <span className="text-xs text-gray-500 font-semibold">Account:</span>{' '}
                      <span className="font-mono font-semibold text-base">{log.accountName}</span>
                    </div>
                  )}

                  <div className="text-sm text-gray-800 leading-relaxed">{log.details}</div>
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end pt-6 border-t border-gray-300">
            <button
              onClick={onClose}
              className="bg-black text-white px-8 py-3 rounded-lg hover:bg-gray-800 transition-colors font-semibold text-base shadow-md"
            >
              Close
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-gray-600">
          Failed to load batch details
        </div>
      )}
      </DialogContent>
    </Dialog>
  );
}
