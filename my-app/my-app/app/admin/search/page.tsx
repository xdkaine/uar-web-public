'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useToast } from '@/hooks/useToast';
import RequestDetailModal from '@/components/admin/RequestDetailModal';
import { useAdminPageTracking } from '@/hooks/useAdminPageTracking';

interface SearchResult {
  id: string;
  type: string;
  [key: string]: any;
}

interface SearchResults {
  accessRequests: SearchResult[];
  lifecycleActions: SearchResult[];
  vpnAccounts: SearchResult[];
  supportTickets: SearchResult[];
  auditLogs: SearchResult[];
  totalResults: number;
  searchQuery: string;
  searchType: string;
}

export default function GlobalSearchPage() {
  const { showToast } = useToast();
  useAdminPageTracking('Admin Global Search', 'navigation');

  useEffect(() => {
    document.title = 'Global Search | User Access Request (UAR) Portal';
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<'all' | 'requests' | 'lifecycle' | 'vpn' | 'tickets' | 'audit'>('all');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);

  // Collapsible state for each category - all collapsed by default
  const [collapsedCategories, setCollapsedCategories] = useState({
    accessRequests: true,
    lifecycleActions: true,
    vpnAccounts: true,
    supportTickets: true,
    auditLogs: true,
  });

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();

    if (!searchQuery || searchQuery.length < 2) {
      showToast('Please enter at least 2 characters to search', 'error');
      return;
    }

    setLoading(true);
    setSearched(true);

    try {
      const res = await fetch(`/api/admin/search?q=${encodeURIComponent(searchQuery)}&type=${searchType}`);

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Search failed');
      }

      const data = await res.json();
      setResults(data);
    } catch (error) {
      console.error('Search error:', error);
      showToast(error instanceof Error ? error.message : 'Search failed', 'error');
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string, type: string) => {
    const statusColors: Record<string, string> = {
      // Access Requests
      pending_verification: 'bg-gray-100 text-gray-800',
      pending_student_directors: 'bg-blue-100 text-blue-800',
      pending_faculty: 'bg-yellow-100 text-yellow-800',
      approved: 'bg-green-100 text-green-800',
      rejected: 'bg-red-100 text-red-800',
      offboarded: 'bg-slate-100 text-slate-800',

      // Lifecycle Actions
      pending: 'bg-gray-100 text-gray-800',
      queued: 'bg-blue-100 text-blue-800',
      processing: 'bg-yellow-100 text-yellow-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
      cancelled: 'bg-gray-300 text-gray-700',

      // VPN Accounts
      active: 'bg-green-100 text-green-800',
      revoked: 'bg-red-100 text-red-800',
      expired: 'bg-gray-100 text-gray-800',

      // Support Tickets
      open: 'bg-blue-100 text-blue-800',
      in_progress: 'bg-yellow-100 text-yellow-800',
      resolved: 'bg-green-100 text-green-800',
      closed: 'bg-gray-100 text-gray-800',
    };

    return (
      <span className={`px-2 py-1 rounded-full text-xs font-semibold ${statusColors[status] || 'bg-gray-100 text-gray-800'}`}>
        {status.replace(/_/g, ' ').toUpperCase()}
      </span>
    );
  };

  const getTypeIcon = (type: string) => {
    const icons: Record<string, React.ReactElement> = {
      access_request: (
        <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      lifecycle_action: (
        <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      ),
      vpn_account: (
        <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      ),
      support_ticket: (
        <svg className="w-5 h-5 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
        </svg>
      ),
      audit_log: (
        <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
    };
    return icons[type] || icons.access_request;
  };

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      access_request: 'Access Request',
      lifecycle_action: 'Lifecycle Action',
      vpn_account: 'VPN Account',
      support_ticket: 'Support Ticket',
      audit_log: 'Audit Log',
    };
    return labels[type] || type;
  };

  const toggleCategory = (category: keyof typeof collapsedCategories) => {
    setCollapsedCategories(prev => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const renderAccessRequest = (item: SearchResult) => (
    <div
      key={item.id}
      onClick={() => setSelectedRequestId(item.id)}
      className="bg-white border-2 border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow cursor-pointer"
    >
      <div className="flex items-start gap-3">
        {getTypeIcon('access_request')}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <h4 className="font-semibold text-lg text-gray-900 break-words">{item.name}</h4>
            {getStatusBadge(item.status, 'access_request')}
            {item.isInternal && (
              <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded text-xs font-semibold">INTERNAL</span>
            )}
          </div>
          <div className="space-y-1 text-sm text-gray-700">
            <p className="break-words"><span className="font-semibold text-gray-900">Email:</span> {item.email}</p>
            {item.username && <p className="break-words"><span className="font-semibold text-gray-900">Username:</span> {item.username}</p>}
            {item.event && <p className="break-words"><span className="font-semibold text-gray-900">Event:</span> {item.event}</p>}
            {item.institution && <p className="break-words"><span className="font-semibold text-gray-900">Institution:</span> {item.institution}</p>}
            <p className="text-xs text-gray-600 break-all">
              <span className="font-semibold text-gray-800">ID:</span> {item.id} |
              <span className="ml-2">{new Date(item.createdAt).toLocaleString()}</span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  const renderLifecycleAction = (item: SearchResult) => (
    <Link href={`/admin?tab=lifecycle`} key={item.id}>
      <div className="bg-white border-2 border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow cursor-pointer">
        <div className="flex items-start gap-3">
          {getTypeIcon('lifecycle_action')}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h4 className="font-semibold text-lg text-gray-900 break-words">{item.actionType.replace(/_/g, ' ').toUpperCase()}</h4>
              {getStatusBadge(item.status, 'lifecycle_action')}
              <span className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-semibold">
                {item.targetAccountType}
              </span>
            </div>
            <div className="space-y-1 text-sm text-gray-700">
              <p className="break-words"><span className="font-semibold text-gray-900">Target:</span> {item.targetUsername}</p>
              <p className="break-words"><span className="font-semibold text-gray-900">Reason:</span> {item.reason}</p>
              <p className="break-words"><span className="font-semibold text-gray-900">Requested By:</span> {item.requestedBy}</p>
              {item.relatedRequestId && (
                <p className="break-all"><span className="font-semibold text-gray-900">Request ID:</span> {item.relatedRequestId}</p>
              )}
              {item.relatedTicketId && (
                <p className="break-all"><span className="font-semibold text-gray-900">Ticket ID:</span> {item.relatedTicketId}</p>
              )}
              <p className="text-xs text-gray-600 break-all">
                <span className="font-semibold text-gray-800">ID:</span> {item.id} |
                <span className="ml-2">{new Date(item.createdAt).toLocaleString()}</span>
                {item.completedAt && <span className="ml-2">Completed: {new Date(item.completedAt).toLocaleString()}</span>}
              </p>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );

  const renderVPNAccount = (item: SearchResult) => (
    <Link href={`/admin?tab=vpn`} key={item.id}>
      <div className="bg-white border-2 border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow cursor-pointer">
        <div className="flex items-start gap-3">
          {getTypeIcon('vpn_account')}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h4 className="font-semibold text-lg text-gray-900 break-words">{item.username}</h4>
              {getStatusBadge(item.status, 'vpn_account')}
              <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-semibold">
                {item.portalType}
              </span>
            </div>
            <div className="space-y-1 text-sm text-gray-700">
              <p className="break-words"><span className="font-semibold text-gray-900">Name:</span> {item.fullName}</p>
              <p className="break-words"><span className="font-semibold text-gray-900">Email:</span> {item.email}</p>
              {item.expiresAt && (
                <p><span className="font-semibold text-gray-900">Expires:</span> {new Date(item.expiresAt).toLocaleDateString()}</p>
              )}
              {item.revokedReason && (
                <p className="break-words"><span className="font-semibold text-gray-900">Revoked Reason:</span> {item.revokedReason}</p>
              )}
              <p className="text-xs text-gray-600 break-all">
                <span className="font-semibold text-gray-800">ID:</span> {item.id} |
                <span className="ml-2">Created: {new Date(item.createdAt).toLocaleString()}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );

  const renderSupportTicket = (item: SearchResult) => (
    <Link href={`/admin?tab=tickets`} key={item.id}>
      <div className="bg-white border-2 border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow cursor-pointer">
        <div className="flex items-start gap-3">
          {getTypeIcon('support_ticket')}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <h4 className="font-semibold text-lg text-gray-900">#{item.ticketNumber}</h4>
              {getStatusBadge(item.status, 'support_ticket')}
              <span className={`px-2 py-1 rounded text-xs font-semibold ${item.priority === 'high' ? 'bg-red-100 text-red-700' :
                item.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-gray-100 text-gray-700'
                }`}>
                {item.priority.toUpperCase()}
              </span>
            </div>
            <div className="space-y-1 text-sm text-gray-700">
              <p className="font-semibold text-gray-900 break-words">{item.subject}</p>
              <p className="break-words"><span className="font-semibold text-gray-900">Category:</span> {item.category}</p>
              <p className="break-words"><span className="font-semibold text-gray-900">Requester:</span> {item.requesterName} ({item.requesterEmail})</p>
              {item.assignedTo && <p className="break-words"><span className="font-semibold text-gray-900">Assigned To:</span> {item.assignedTo}</p>}
              <p className="text-xs text-gray-600 break-all">
                <span className="font-semibold text-gray-800">ID:</span> {item.id} |
                <span className="ml-2">{new Date(item.createdAt).toLocaleString()}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );

  const renderAuditLog = (item: SearchResult) => (
    <div key={item.id} className="bg-white border-2 border-gray-200 rounded-lg p-4">
      <div className="flex items-start gap-3">
        {getTypeIcon('audit_log')}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <h4 className="font-semibold text-lg text-gray-900 break-words">{item.action}</h4>
            <span className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded text-xs font-semibold">
              {item.category}
            </span>
          </div>
          <div className="space-y-1 text-sm text-gray-700">
            <p className="break-words"><span className="font-semibold text-gray-900">User:</span> {item.username}</p>
            {item.targetId && <p className="break-all"><span className="font-semibold text-gray-900">Target ID:</span> {item.targetId}</p>}
            {item.targetType && <p className="break-words"><span className="font-semibold text-gray-900">Target Type:</span> {item.targetType}</p>}
            <p className="break-words"><span className="font-semibold text-gray-900">IP Address:</span> {item.ipAddress}</p>
            <p className="text-xs text-gray-600">
              {new Date(item.timestamp).toLocaleString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Global Search</h1>
          <p className="text-gray-700">Search across all access requests, lifecycle actions, VPN accounts, support tickets, and audit logs</p>
        </div>

        <div className="bg-white rounded-lg shadow-lg border-2 border-gray-200 p-6 mb-6">
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, email, username, ticket ID, request ID..."
                  className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent text-lg text-gray-900 placeholder:text-gray-500"
                  disabled={loading}
                />
              </div>
              <select
                value={searchType}
                onChange={(e) => setSearchType(e.target.value as any)}
                className="px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent"
                disabled={loading}
              >
                <option value="all">All Types</option>
                <option value="requests">Access Requests</option>
                <option value="lifecycle">Lifecycle Actions</option>
                <option value="vpn">VPN Accounts</option>
                <option value="tickets">Support Tickets</option>
                <option value="audit">Audit Logs</option>
              </select>
              <button
                type="submit"
                disabled={loading || searchQuery.length < 2}
                className="px-8 py-3 bg-black text-white rounded-lg hover:bg-gray-800 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold flex items-center gap-2"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Searching...
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    Search
                  </>
                )}
              </button>
            </div>
          </form>
        </div>

        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-gray-600">Searching...</p>
          </div>
        )}

        {!loading && searched && results && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-lg border-2 border-gray-200 p-6">
              <h2 className="text-xl text-gray-900 font-bold mb-4">
                Search Results for &quot;{results.searchQuery}&quot;
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center">
                  <div className="text-3xl font-bold text-blue-600">{results.accessRequests.length}</div>
                  <div className="text-sm text-gray-700">Access Requests</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-purple-600">{results.lifecycleActions.length}</div>
                  <div className="text-sm text-gray-700">Lifecycle Actions</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-green-600">{results.vpnAccounts.length}</div>
                  <div className="text-sm text-gray-700">VPN Accounts</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-yellow-600">{results.supportTickets.length}</div>
                  <div className="text-sm text-gray-700">Support Tickets</div>
                </div>
                <div className="text-center">
                  <div className="text-3xl font-bold text-gray-600">{results.auditLogs.length}</div>
                  <div className="text-sm text-gray-700">Audit Logs</div>
                </div>
              </div>
              <div className="mt-4 text-center">
                <span className="text-2xl font-bold text-gray-900">{results.totalResults}</span>
                <span className="text-gray-700 ml-2">total results</span>
              </div>
            </div>

            {results.totalResults === 0 && (
              <div className="bg-white rounded-lg shadow-lg border-2 border-gray-200 p-12 text-center">
                <svg className="w-16 h-16 text-gray-400 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M12 12h.01M12 12h.01M12 12h.01M12 12h.01M12 21a9 9 0 100-18 9 9 0 000 18z" />
                </svg>
                <h3 className="text-xl font-semibold text-gray-700 mb-2">No results found</h3>
                <p className="text-gray-600">Try adjusting your search query or filters</p>
              </div>
            )}

            {results.accessRequests.length > 0 && (
              <div>
                <button
                  onClick={() => toggleCategory('accessRequests')}
                  className="w-full text-left flex items-center justify-between text-xl font-bold mb-4 p-4 bg-white rounded-lg shadow border-2 border-gray-200 hover:bg-gray-50 transition-colors text-gray-900"
                >
                  <div className="flex items-center gap-2">
                    {getTypeIcon('access_request')}
                    <span>Access Requests ({results.accessRequests.length})</span>
                  </div>
                  <svg
                    className={`w-6 h-6 transition-transform ${collapsedCategories.accessRequests ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!collapsedCategories.accessRequests && (
                  <div className="space-y-3 mb-4">
                    {results.accessRequests.map(renderAccessRequest)}
                  </div>
                )}
              </div>
            )}

            {results.lifecycleActions.length > 0 && (
              <div>
                <button
                  onClick={() => toggleCategory('lifecycleActions')}
                  className="w-full text-left flex items-center justify-between text-xl font-bold mb-4 p-4 bg-white rounded-lg shadow border-2 border-gray-200 hover:bg-gray-50 transition-colors text-gray-900"
                >
                  <div className="flex items-center gap-2">
                    {getTypeIcon('lifecycle_action')}
                    <span>Lifecycle Actions ({results.lifecycleActions.length})</span>
                  </div>
                  <svg
                    className={`w-6 h-6 transition-transform ${collapsedCategories.lifecycleActions ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!collapsedCategories.lifecycleActions && (
                  <div className="space-y-3 mb-4">
                    {results.lifecycleActions.map(renderLifecycleAction)}
                  </div>
                )}
              </div>
            )}

            {results.vpnAccounts.length > 0 && (
              <div>
                <button
                  onClick={() => toggleCategory('vpnAccounts')}
                  className="w-full text-left flex items-center justify-between text-xl font-bold mb-4 p-4 bg-white rounded-lg shadow border-2 border-gray-200 hover:bg-gray-50 transition-colors text-gray-900"
                >
                  <div className="flex items-center gap-2">
                    {getTypeIcon('vpn_account')}
                    <span>VPN Accounts ({results.vpnAccounts.length})</span>
                  </div>
                  <svg
                    className={`w-6 h-6 transition-transform ${collapsedCategories.vpnAccounts ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!collapsedCategories.vpnAccounts && (
                  <div className="space-y-3 mb-4">
                    {results.vpnAccounts.map(renderVPNAccount)}
                  </div>
                )}
              </div>
            )}

            {results.supportTickets.length > 0 && (
              <div>
                <button
                  onClick={() => toggleCategory('supportTickets')}
                  className="w-full text-left flex items-center justify-between text-xl font-bold mb-4 p-4 bg-white rounded-lg shadow border-2 border-gray-200 hover:bg-gray-50 transition-colors text-gray-900"
                >
                  <div className="flex items-center gap-2">
                    {getTypeIcon('support_ticket')}
                    <span>Support Tickets ({results.supportTickets.length})</span>
                  </div>
                  <svg
                    className={`w-6 h-6 transition-transform ${collapsedCategories.supportTickets ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!collapsedCategories.supportTickets && (
                  <div className="space-y-3 mb-4">
                    {results.supportTickets.map(renderSupportTicket)}
                  </div>
                )}
              </div>
            )}

            {results.auditLogs.length > 0 && (
              <div>
                <button
                  onClick={() => toggleCategory('auditLogs')}
                  className="w-full text-left flex items-center justify-between text-xl font-bold mb-4 p-4 bg-white rounded-lg shadow border-2 border-gray-200 hover:bg-gray-50 transition-colors text-gray-900"
                >
                  <div className="flex items-center gap-2">
                    {getTypeIcon('audit_log')}
                    <span>Audit Logs ({results.auditLogs.length})</span>
                  </div>
                  <svg
                    className={`w-6 h-6 transition-transform ${collapsedCategories.auditLogs ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!collapsedCategories.auditLogs && (
                  <div className="space-y-3 mb-4">
                    {results.auditLogs.map(renderAuditLog)}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {!loading && !searched && (
          <div className="bg-white rounded-lg shadow-lg border-2 border-gray-200 p-12 text-center">
            <svg className="w-20 h-20 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <h3 className="text-xl font-semibold text-gray-700 mb-2">Start Your Search</h3>
            <p className="text-gray-600 mb-4">Enter a search query to find access requests, lifecycle actions, VPN accounts, tickets, or audit logs</p>
            <div className="text-sm text-gray-500 space-y-1">
              <p>• Search by name, email, or username</p>
              <p>• Search by ticket ID or request ID</p>
              <p>• Filter by specific entity types</p>
            </div>
          </div>
        )}
      </div>

      {selectedRequestId && (
        <RequestDetailModal
          requestId={selectedRequestId}
          onClose={() => setSelectedRequestId(null)}
        />
      )}
    </div>
  );
}
