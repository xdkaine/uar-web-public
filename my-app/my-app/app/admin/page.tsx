'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AccessRequestsTab from '@/components/admin/AccessRequestsTab';
import EventManagementTab from '@/components/admin/EventManagementTab';
import UserManagementTab from '@/components/admin/UserManagementTab';
import SupportTicketsTab from '@/components/admin/SupportTicketsTab';
import BatchAccountsTab from '@/components/admin/BatchAccountsTab';
import BlocklistTab from '@/components/admin/BlocklistTab';
import VPNManagementTab from '@/components/admin/VPNManagementTab';
import SystemSettingsTab from '@/components/admin/SystemSettingsTab';
import LogsTab from '@/components/admin/LogsTab';
import SessionManagementTab from '@/components/admin/SessionManagementTab';
import RateLimitManagementTab from '@/components/admin/RateLimitManagementTab';
import AccountLifecycleTab from '@/components/admin/AccountLifecycleTab';
import AccountSyncStatusTab from '@/components/admin/AccountSyncStatusTab';
import ActionHistoryMonitoringTab from '@/components/admin/ActionHistoryMonitoringTab';
import CommunicationsTab from '@/components/admin/CommunicationsTab';
import OffboardCampaignsPanel from '@/components/admin/OffboardCampaignsPanel';
import { useAdminPageTracking } from '@/hooks/useAdminPageTracking';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Search, Settings, Users, Shield, Activity, RefreshCw,
  Ban, Monitor, FileText, Ticket, Package, Calendar,
  ChevronDown, Menu, ClipboardList, LifeBuoy, ShieldAlert, Gauge
} from "lucide-react";

interface LDAPUser {
  dn: string;
  username: string;
  displayName: string;
  email: string;
  description: string;
  accountEnabled: boolean;
  accountExpires: string | null;
  whenCreated: string;
  memberOf: string[];
  lastVerifiedAt?: string | null;
  lastVerifiedSource?: string | null;
  originalRegistrationAt?: string | null;
}

interface TicketResponse {
  id: string;
  message: string;
  author: string;
  isStaff: boolean;
  createdAt: string;
}

interface TicketStatusLog {
  id: string;
  createdAt: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string;
  isStaff: boolean;
}

interface SupportTicket {
  id: string;
  subject: string;
  category: string | null;
  severity: string | null;
  body: string;
  status: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  responses: TicketResponse[];
  statusLogs: TicketStatusLog[];
}

interface BatchCreation {
  id: string;
  createdAt: string;
  createdBy: string;
  description: string;
  totalAccounts: number;
  successfulAccounts: number;
  failedAccounts: number;
  status: string;
  completedAt?: string;
  linkedTicket?: {
    id: string;
    subject: string;
    status: string;
  };
  accounts: Array<{
    id: string;
    name: string;
    ldapUsername: string;
    status: string;
    errorMessage?: string;
  }>;
  _count: {
    accounts: number;
    auditLogs: number;
  };
}

type AdminTab =
  | 'requests'
  | 'events'
  | 'users'
  | 'support'
  | 'batch'
  | 'vpn'
  | 'blocklist'
  | 'settings'
  | 'logs'
  | 'action-history'
  | 'sessions'
  | 'ratelimits'
  | 'lifecycle'
  | 'sync-status'
  | 'communications'
  | 'offboard-campaigns';

const adminTabs: AdminTab[] = [
  'requests',
  'events',
  'users',
  'support',
  'batch',
  'vpn',
  'blocklist',
  'settings',
  'logs',
  'action-history',
  'sessions',
  'ratelimits',
  'lifecycle',
  'sync-status',
  'communications',
  'offboard-campaigns',
];

function isAdminTab(tab: string | null): tab is AdminTab {
  return tab !== null && adminTabs.includes(tab as AdminTab);
}

export default function AdminDashboard() {
  const [activeTab, setActiveTab] = useState<AdminTab>('requests');
  const [users, setUsers] = useState<LDAPUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [batches, setBatches] = useState<BatchCreation[]>([]);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    document.title = 'Admin Dashboard | User Access Request (UAR) Portal';
  }, []);

  useEffect(() => {
    const tab = searchParams.get('tab');
    if (isAdminTab(tab)) {
      setActiveTab(tab);
    }
  }, [searchParams]);

  // Track page views for the active tab
  const getCategoryForTab = (tab: string) => {
    const categoryMap: Record<string, string> = {
      requests: 'access_request',
      batch: 'batch',
      vpn: 'vpn',
      support: 'support',
      blocklist: 'blocklist',
      events: 'event',
      users: 'user',
      settings: 'settings',
      logs: 'logs',
      sessions: 'session',
      ratelimits: 'rate_limit',
      lifecycle: 'lifecycle',
      'sync-status': 'sync_status',
      communications: 'communications',
      'offboard-campaigns': 'offboard_campaign',
    };
    return categoryMap[tab] || 'navigation';
  };

  useAdminPageTracking(`Admin Dashboard - ${activeTab}`, getCategoryForTab(activeTab));

  const fetchSupportTickets = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/support/tickets');
      if (response.status === 401 || response.status === 403) {
        router.push('/login?redirect=' + encodeURIComponent('/admin'));
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch support tickets');
      const data = await response.json();
      setSupportTickets(data.tickets || []);
    } catch (error) {
      console.error('Error fetching support tickets:', error);
    }
  }, [router]);

  const fetchBatches = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/batch-accounts');
      if (response.status === 401 || response.status === 403) {
        router.push('/login?redirect=' + encodeURIComponent('/admin'));
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch batches');
      const data = await response.json();
      setBatches(data.batches || []);
    } catch (error) {
      console.error('Error fetching batches:', error);
    }
  }, [router]);

  const fetchUsers = useCallback(async () => {
    try {
      setUsersLoading(true);
      const response = await fetch('/api/admin/users');
      if (response.status === 401 || response.status === 403) {
        router.push('/login?redirect=' + encodeURIComponent('/admin'));
        return;
      }
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        const errorMsg = errorData.details || errorData.error || 'Unknown error';

        if (errorMsg.includes('0x4') || errorMsg.includes('0x2c')) {
          console.warn('LDAP query size limit exceeded. Some users may not be displayed.');
          setUsers([]);
          return;
        }

        throw new Error('Failed to fetch users: ' + errorMsg);
      }
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error('Error fetching users:', error);
      if (error instanceof Error && !error.message.includes('0x')) {
        console.error('Unexpected error loading users:', error.message);
      }
    } finally {
      setUsersLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (activeTab === 'batch') {
      fetchBatches();
      fetchSupportTickets();
    }

    if (activeTab === 'offboard-campaigns') {
      fetchUsers();
    }
  }, [activeTab, fetchBatches, fetchSupportTickets, fetchUsers]);

  return (
    <div className="min-h-screen bg-gray-50/50 text-gray-900">
      <div className="container mx-auto px-4 py-6 sm:py-8 space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-gray-900">Admin Dashboard</h1>
            <p className="text-gray-500 mt-1">Cal Poly Pomona Student SOC</p>
          </div>
          <Button asChild>
            <a href="/admin/search" className="gap-2">
              <Search className="h-4 w-4" />
              Global Search
            </a>
          </Button>
        </div>

        <Card className="shadow-sm">
          <div className="p-2 flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 h-9">
                  <Menu className="h-4 w-4" />
                  Operations
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={() => setActiveTab('requests')} className="gap-2">
                  <ClipboardList className="h-4 w-4" /> Access Requests
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('support')} className="gap-2">
                  <LifeBuoy className="h-4 w-4" /> Support Tickets
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('batch')} className="gap-2">
                  <Package className="h-4 w-4" /> Batch Accounts
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('events')} className="gap-2">
                  <Calendar className="h-4 w-4" /> Events
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('offboard-campaigns')} className="gap-2">
                  <ShieldAlert className="h-4 w-4" /> Offboard Campaigns
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 h-9">
                  <Users className="h-4 w-4" />
                  Account Management
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={() => setActiveTab('users')} className="gap-2">
                  <Users className="h-4 w-4" /> Active Directory
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('vpn')} className="gap-2">
                  <Shield className="h-4 w-4" /> VPN Management
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('lifecycle')} className="gap-2">
                  <Activity className="h-4 w-4" /> Account Lifecycle
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('sync-status')} className="gap-2">
                  <RefreshCw className="h-4 w-4" /> Sync Status
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('communications')} className="gap-2">
                  <Ticket className="h-4 w-4" /> Communications
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 h-9">
                  <Settings className="h-4 w-4" />
                  Configuration
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={() => setActiveTab('settings')} className="gap-2">
                  <Settings className="h-4 w-4" /> System Settings
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('blocklist')} className="gap-2">
                  <Ban className="h-4 w-4" /> Blocklist
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 h-9">
                  <Monitor className="h-4 w-4" />
                  Monitoring
                  <ChevronDown className="h-4 w-4 text-gray-500" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem onClick={() => setActiveTab('sessions')} className="gap-2">
                  <Users className="h-4 w-4" /> Active Sessions
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('ratelimits')} className="gap-2">
                  <Gauge className="h-4 w-4" /> Rate Limiting
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('logs')} className="gap-2">
                  <FileText className="h-4 w-4" /> Audit Logs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setActiveTab('action-history')} className="gap-2">
                  <Activity className="h-4 w-4" /> Action History
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="ml-auto px-4 py-2 text-sm font-medium text-blue-600 hidden sm:block">
              {activeTab === 'requests' && 'Access Requests'}
              {activeTab === 'support' && 'Support Tickets'}
              {activeTab === 'batch' && 'Batch Accounts'}
              {activeTab === 'events' && 'Events'}
              {activeTab === 'offboard-campaigns' && 'Offboard Campaigns'}
              {activeTab === 'users' && 'Active Directory'}
              {activeTab === 'vpn' && 'VPN Management'}
              {activeTab === 'lifecycle' && 'Account Lifecycle'}
              {activeTab === 'sync-status' && 'Account Sync Status'}
              {activeTab === 'settings' && 'System Settings'}
              {activeTab === 'blocklist' && 'Blocklist'}
              {activeTab === 'sessions' && 'Active Sessions'}
              {activeTab === 'ratelimits' && 'Rate Limiting'}
              {activeTab === 'logs' && 'Audit Logs'}
              {activeTab === 'action-history' && 'Action History'}
              {activeTab === 'communications' && 'Communications'}
            </div>
          </div>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-6">
            {activeTab === 'requests' && <AccessRequestsTab />}
            {activeTab === 'batch' && (
              <BatchAccountsTab
                batches={batches}
                supportTickets={supportTickets.filter(t => t.status === 'open' || t.status === 'in-progress')}
                onBatchCreated={fetchBatches}
              />
            )}
            {activeTab === 'vpn' && <VPNManagementTab />}
            {activeTab === 'lifecycle' && <AccountLifecycleTab />}
            {activeTab === 'sync-status' && <AccountSyncStatusTab />}
            {activeTab === 'communications' && <CommunicationsTab />}
            {activeTab === 'offboard-campaigns' && <OffboardCampaignsPanel accounts={users} accountsLoading={usersLoading} />}
            {activeTab === 'support' && <SupportTicketsTab />}
            {activeTab === 'blocklist' && <BlocklistTab />}
            {activeTab === 'events' && <EventManagementTab />}
            {activeTab === 'users' && <UserManagementTab />}
            {activeTab === 'sessions' && <SessionManagementTab />}
            {activeTab === 'ratelimits' && <RateLimitManagementTab />}
            {activeTab === 'settings' && <SystemSettingsTab isLoading={false} onRefresh={() => { }} />}
            {activeTab === 'logs' && <LogsTab isLoading={false} />}
            {activeTab === 'action-history' && <ActionHistoryMonitoringTab />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
