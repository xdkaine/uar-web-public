'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAdminPageTracking } from '@/hooks/useAdminPageTracking';

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

export default function BatchDetailPage() {
  const params = useParams();
  const batchId = params.id as string;
  useAdminPageTracking(`Batch Detail - ${batchId ?? 'unknown'}`, 'batch');

  const [batch, setBatch] = useState<BatchDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'accounts' | 'audit'>('accounts');

  useEffect(() => {
    document.title = 'Batch Operation Details | User Access Request (UAR) Portal';
  }, []);

  useEffect(() => {
    const fetchBatchDetails = async () => {
      if (!batchId) return;

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/admin/batch-accounts/${batchId}`);
        const data = await response.json();

        if (response.ok) {
          setBatch(data.batch);
        } else {
          setError(data.error || 'Failed to load batch details');
        }
      } catch (err) {
        console.error('Error fetching batch details:', err);
        setError('Failed to load batch details');
      } finally {
        setLoading(false);
      }
    };

    fetchBatchDetails();
  }, [batchId]);

  const getStatusBadge = (status: string) => {
    const styles = {
      processing: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      partial: 'bg-yellow-100 text-yellow-800',
      skipped: 'bg-gray-100 text-gray-800',
    };

    return (
      <span className={`px-4 py-2 rounded-full text-sm font-bold ${styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800'}`}>
        {status.toUpperCase()}
      </span>
    );
  };

  const getActionBadge = (action: string, success: boolean) => {
    const actionStyles = {
      batch_created: 'bg-blue-100 text-blue-800',
      batch_completed: 'bg-green-100 text-green-800',
      ad_account_created: 'bg-green-100 text-green-800',
      ad_account_failed: 'bg-red-100 text-red-800',
      ldap_account_created: 'bg-green-100 text-green-800',
      ldap_account_failed: 'bg-red-100 text-red-800',
      vpn_account_created: 'bg-purple-100 text-purple-800',
      vpn_account_failed: 'bg-red-100 text-red-800',
      account_processing_failed: 'bg-red-100 text-red-800',
    };

    const style = actionStyles[action as keyof typeof actionStyles] || (success ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800');

    return (
      <span className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase ${style}`}>
        {action.replace(/_/g, ' ')}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-2xl font-bold text-gray-800 mb-2">Loading batch details...</div>
          <div className="text-gray-600">Please wait</div>
        </div>
      </div>
    );
  }

  if (error || !batch) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-2xl font-bold text-red-600 mb-4">Error</div>
          <div className="text-gray-700 mb-6">{error || 'Batch not found'}</div>
          <Link
            href="/admin"
            className="inline-block bg-black text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition-colors font-semibold"
          >
            Back to Admin Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/admin"
                className="text-gray-600 hover:text-gray-900 transition-colors"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </Link>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Batch Operation Details</h1>
                <p className="text-sm text-gray-600 mt-1">Batch ID: <span className="font-mono">{batch.id}</span></p>
              </div>
            </div>
            {getStatusBadge(batch.status)}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="space-y-8">
          <div className="bg-white rounded-xl p-8 shadow-md border border-gray-200">
            <h2 className="text-2xl font-bold mb-6 text-gray-800">Batch Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-gray-50 px-6 py-4 rounded-lg border border-gray-200">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Created By</div>
                <div className="font-semibold text-xl">{batch.createdBy}</div>
              </div>
              <div className="bg-gray-50 px-6 py-4 rounded-lg border border-gray-200">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Created At</div>
                <div className="text-base">{new Date(batch.createdAt).toLocaleString()}</div>
              </div>
              <div className="bg-gray-50 px-6 py-4 rounded-lg border border-gray-200">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Completed At</div>
                <div className="text-base">
                  {batch.completedAt ? new Date(batch.completedAt).toLocaleString() : 'In Progress'}
                </div>
              </div>
              <div className="md:col-span-3 bg-gray-50 px-6 py-4 rounded-lg border border-gray-200">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Description</div>
                <div className="text-base text-gray-800">{batch.description || 'No description provided'}</div>
              </div>
            </div>

            {batch.linkedTicket && (
              <div className="mt-8 pt-8 border-t border-gray-300">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Linked Support Ticket</div>
                <div className="bg-blue-50 p-6 rounded-lg border border-blue-200">
                  <div className="font-bold text-lg mb-2">{batch.linkedTicket.subject}</div>
                  <div className="text-sm text-gray-600 mb-4">Ticket ID: <span className="font-mono">{batch.linkedTicket.id}</span></div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <span className="bg-white px-4 py-2 rounded-full border border-blue-300">
                      Status: <span className="font-semibold">{batch.linkedTicket.status}</span>
                    </span>
                    {batch.linkedTicket.category && (
                      <span className="bg-white px-4 py-2 rounded-full border border-blue-300">
                        Category: <span className="font-semibold">{batch.linkedTicket.category}</span>
                      </span>
                    )}
                    {batch.linkedTicket.severity && (
                      <span className="bg-white px-4 py-2 rounded-full border border-blue-300">
                        Severity: <span className="font-semibold">{batch.linkedTicket.severity}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-8 pt-8 border-t border-gray-300 grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="text-center bg-gray-50 rounded-xl p-6 border-2 border-gray-300">
                <div className="text-5xl font-bold text-gray-800 mb-2">{batch.totalAccounts}</div>
                <div className="text-sm text-gray-600 font-semibold uppercase tracking-wide">Total Accounts</div>
              </div>
              <div className="text-center bg-green-50 rounded-xl p-6 border-2 border-green-300">
                <div className="text-5xl font-bold text-green-600 mb-2">{batch.successfulAccounts}</div>
                <div className="text-sm text-gray-600 font-semibold uppercase tracking-wide">Successful</div>
              </div>
              <div className="text-center bg-red-50 rounded-xl p-6 border-2 border-red-300">
                <div className="text-5xl font-bold text-red-600 mb-2">{batch.failedAccounts}</div>
                <div className="text-sm text-gray-600 font-semibold uppercase tracking-wide">Failed</div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-md border border-gray-200">
            <div className="border-b border-gray-200">
              <div className="flex gap-8 px-8 pt-6">
                <button
                  onClick={() => setActiveTab('accounts')}
                  className={`pb-4 px-2 font-bold text-lg transition-colors ${activeTab === 'accounts'
                      ? 'border-b-4 border-black text-black'
                      : 'text-gray-500 hover:text-gray-800'
                    }`}
                >
                  Accounts ({batch.accounts.length})
                </button>
                <button
                  onClick={() => setActiveTab('audit')}
                  className={`pb-4 px-2 font-bold text-lg transition-colors ${activeTab === 'audit'
                      ? 'border-b-4 border-black text-black'
                      : 'text-gray-500 hover:text-gray-800'
                    }`}
                >
                  Audit Trail ({batch.auditLogs.length})
                </button>
              </div>
            </div>

            {activeTab === 'accounts' && (
              <div className="p-8 space-y-6">
                {batch.accounts.map((account) => (
                  <div key={account.id} className="bg-gray-50 border border-gray-300 rounded-xl p-6 hover:shadow-md transition-shadow">
                    <div className="flex justify-between items-start mb-5">
                      <div>
                        <div className="font-bold text-2xl text-gray-800">{account.name}</div>
                        <div className="text-base text-gray-600 mt-1">{account.email}</div>
                      </div>
                      {getStatusBadge(account.status)}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <div className="bg-white px-5 py-4 rounded-lg border border-gray-200">
                        <div className="text-xs text-gray-500 mb-2 font-semibold uppercase">LDAP Username</div>
                        <div className="font-semibold font-mono text-lg">{account.ldapUsername}</div>
                      </div>
                      {account.vpnUsername && (
                        <div className="bg-white px-5 py-4 rounded-lg border border-gray-200">
                          <div className="text-xs text-gray-500 mb-2 font-semibold uppercase">VPN Username</div>
                          <div className="font-semibold font-mono text-lg">{account.vpnUsername}</div>
                        </div>
                      )}
                      <div className="bg-white px-5 py-4 rounded-lg border border-gray-200">
                        <div className="text-xs text-gray-500 mb-2 font-semibold uppercase">Account Type</div>
                        <div className="font-semibold text-lg">{account.isInternal ? 'Internal' : 'External'}</div>
                      </div>
                      {account.accountExpiresAt && (
                        <div className="bg-white px-5 py-4 rounded-lg border border-gray-200">
                          <div className="text-xs text-gray-500 mb-2 font-semibold uppercase">Expiration Date</div>
                          <div className="font-semibold text-lg">{new Date(account.accountExpiresAt).toLocaleString()}</div>
                        </div>
                      )}
                      {account.ldapCreatedAt && (
                        <div className="bg-green-50 px-5 py-4 rounded-lg border border-green-300">
                          <div className="text-xs text-green-700 mb-2 font-semibold uppercase">LDAP Created</div>
                          <div className="font-semibold text-lg text-green-800">{new Date(account.ldapCreatedAt).toLocaleString()}</div>
                        </div>
                      )}
                      {account.vpnCreatedAt && (
                        <div className="bg-purple-50 px-5 py-4 rounded-lg border border-purple-300">
                          <div className="text-xs text-purple-700 mb-2 font-semibold uppercase">VPN Created</div>
                          <div className="font-semibold text-lg text-purple-800">{new Date(account.vpnCreatedAt).toLocaleString()}</div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 mt-5">
                      {account.createAdAccount && (
                        <span className="bg-blue-100 text-blue-800 px-4 py-2 rounded-full text-sm font-bold">
                          AD Account
                        </span>
                      )}
                      {account.createVpnAccount && (
                        <span className="bg-purple-100 text-purple-800 px-4 py-2 rounded-full text-sm font-bold">
                          VPN Account
                        </span>
                      )}
                      {account.needsDomainAccount && (
                        <span className="bg-gray-100 text-gray-800 px-4 py-2 rounded-full text-sm font-bold">
                          Domain Required
                        </span>
                      )}
                    </div>

                    {account.errorMessage && (
                      <div className="mt-5 p-5 bg-red-50 border-2 border-red-300 rounded-lg">
                        <div className="font-bold mb-2 flex items-center gap-2 text-red-900">
                          <span className="text-2xl">⚠️</span>
                          <span className="text-lg">Error Details</span>
                        </div>
                        <div className="ml-8 text-red-800">{account.errorMessage}</div>
                      </div>
                    )}

                    {account.completedAt && (
                      <div className="mt-5 pt-5 border-t border-gray-300 text-sm text-gray-600">
                        <span className="font-semibold">Completed:</span> {new Date(account.completedAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'audit' && (
              <div className="p-8 space-y-5">
                {batch.auditLogs.map((log) => (
                  <div key={log.id} className="bg-gray-50 border border-gray-300 rounded-xl p-6 hover:shadow-md transition-shadow">
                    <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-4 mb-4">
                      <div className="flex items-center gap-4 flex-wrap">
                        {getActionBadge(log.action, log.success)}
                        <span className="text-sm text-gray-600 font-medium">
                          {new Date(log.createdAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="bg-white px-4 py-2 rounded-full border border-gray-300">
                        <span className="text-sm text-gray-600">By:</span>{' '}
                        <span className="font-semibold text-gray-800">{log.performedBy}</span>
                      </div>
                    </div>

                    {log.accountName && (
                      <div className="mb-4 bg-white px-5 py-3 rounded-lg border border-gray-200">
                        <span className="text-xs text-gray-500 font-semibold uppercase">Account:</span>{' '}
                        <span className="font-mono font-semibold text-base ml-2">{log.accountName}</span>
                      </div>
                    )}

                    <div className="text-base text-gray-800 leading-relaxed">{log.details}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-center pb-8">
            <Link
              href="/admin"
              className="bg-black text-white px-8 py-4 rounded-lg hover:bg-gray-800 transition-colors font-semibold text-lg shadow-lg"
            >
              Back to Admin Dashboard
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
