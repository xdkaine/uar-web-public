'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetchWithCsrf } from '@/lib/csrf';
import { fetchJson } from '@/lib/client-query';
import { useToast } from "@/hooks/useToast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { RefreshCw, Search, Monitor, Smartphone, Globe, AlertTriangle, Trash2, UserX } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface Session {
  id: string;
  username: string;
  isAdmin: boolean;
  createdAt: string;
  lastActivity: string;
  expiresAt: string;
  ipAddress?: string;
  userAgent?: string;
}

interface SessionManagementTabProps {
  isLoading?: boolean;
  onRefresh?: () => void;
}

const parseUserAgent = (userAgent?: string) => {
  if (!userAgent) return { browser: 'Unknown', os: 'Unknown' };

  // Simple user agent parsing
  let browser = 'Unknown';
  let os = 'Unknown';

  // Detect OS
  if (userAgent.includes('Windows')) os = 'Windows';
  else if (userAgent.includes('Mac')) os = 'macOS';
  else if (userAgent.includes('Linux')) os = 'Linux';
  else if (userAgent.includes('Android')) os = 'Android';
  else if (userAgent.includes('iOS') || userAgent.includes('iPhone') || userAgent.includes('iPad')) os = 'iOS';

  // Detect Browser
  if (userAgent.includes('Edg/')) browser = 'Edge';
  else if (userAgent.includes('Chrome/')) browser = 'Chrome';
  else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) browser = 'Safari';
  else if (userAgent.includes('Firefox/')) browser = 'Firefox';
  else if (userAgent.includes('Opera/') || userAgent.includes('OPR/')) browser = 'Opera';

  return { browser, os };
};

const formatTimestamp = (timestamp: string) => {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes !== 1 ? 's' : ''} ago`;
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
  return `${days} day${days !== 1 ? 's' : ''} ago`;
};

const getTimeRemaining = (expiresAt: string) => {
  const date = new Date(expiresAt);
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);

  if (minutes < 0) return 'Expired';
  if (minutes < 60) return `${minutes} min`;
  return `${hours} hr ${minutes % 60} min`;
};

function useSessionManagement({ isLoading: initialLoading = false, onRefresh }: SessionManagementTabProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isRefreshing, setIsLoading] = useState(initialLoading);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('lastActivity');
  const [sortOrder, setSortOrder] = useState<string>('desc');
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  
  // Confirmation state
  const [sessionToKill, setSessionToKill] = useState<{id: string, username: string} | null>(null);
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  // "End all sessions for user" state (portal rows + IdP backchannel, ADR-0014)
  const [endAllUsername, setEndAllUsername] = useState('');
  const [userToEndAll, setUserToEndAll] = useState<string | null>(null);
  const [isEndingAll, setIsEndingAll] = useState(false);
  const [canRevoke, setCanRevoke] = useState(false);

  const fetchSessions = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/admin/sessions');
      if (!response.ok) {
        throw new Error('Failed to fetch sessions');
      }
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error('Error fetching sessions:', error);
      setError('Failed to load sessions');
    } finally {
      setIsLoading(false);
    }
  };

  const { isLoading: isQueryLoading } = useSWR<{ sessions?: Session[] }>(
    '/api/admin/sessions',
    fetchJson,
    {
      refreshInterval: 30_000,
      onSuccess: (data) => setSessions(data.sessions || []),
      onError: () => setError('Failed to load sessions'),
    }
  );
  useSWR<{ permissions?: string[] }>('/api/auth/session', fetchJson, {
    onSuccess: (data) => setCanRevoke(
      Array.isArray(data.permissions) && data.permissions.includes('sessions.revoke')
    ),
    onError: () => setCanRevoke(false),
  });
  const isLoading = isRefreshing || isQueryLoading;

  const confirmKillSession = (id: string, username: string) => {
    if (!canRevoke) return;
    setSessionToKill({ id, username });
    setShowKillConfirm(true);
  };

  const handleKillSession = async () => {
    if (!sessionToKill) return;

    try {
      const response = await fetchWithCsrf(`/api/admin/sessions?id=${sessionToKill.id}`, {
        method: 'DELETE'
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to kill session');
      }

      const data = await response.json().catch(() => ({}));
      showToast(
        data.message || `Terminated portal session for ${sessionToKill.username}`,
        data.partial ? 'warning' : 'success'
      );

      fetchSessions(); // Refresh the list
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('Error killing session:', error);
      showToast(error instanceof Error ? error.message : 'Failed to terminate session', "error");
    } finally {
      setShowKillConfirm(false);
      setSessionToKill(null);
    }
  };

  const confirmEndAllForUser = () => {
    if (!canRevoke) return;
    const username = endAllUsername.trim().toLowerCase();
    if (!username) return;
    setUserToEndAll(username);
  };

  const handleEndAllForUser = async () => {
    if (!userToEndAll) return;
    setIsEndingAll(true);
    try {
      const response = await fetchWithCsrf('/api/admin/sessions/end-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: userToEndAll }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || 'Failed to end sessions');
      }
      showToast(data.message || `Ended all sessions for ${userToEndAll}`, data.partial ? 'warning' : 'success');
      setEndAllUsername('');
      fetchSessions();
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('Error ending all sessions:', error);
      showToast(error instanceof Error ? error.message : 'Failed to end sessions', "error");
    } finally {
      setIsEndingAll(false);
      setUserToEndAll(null);
    }
  };

  // Filter and sort sessions
  const filteredSessions = sessions
    .filter(session => {
      if (filterType === 'admin' && !session.isAdmin) return false;
      if (filterType === 'user' && session.isAdmin) return false;
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const { browser, os } = parseUserAgent(session.userAgent);
        return (
          session.username.toLowerCase().includes(query) ||
          (session.ipAddress?.toLowerCase().includes(query) ?? false) ||
          browser.toLowerCase().includes(query) ||
          os.toLowerCase().includes(query)
        );
      }
      return true;
    })
    .sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      // @ts-expect-error - dynamic access
      const aProp = a[sortBy];
      // @ts-expect-error - dynamic access
      const bProp = b[sortBy];

      if (sortBy === 'username') {
        aVal = a.username;
        bVal = b.username;
      } else {
        aVal = new Date(aProp).getTime();
        bVal = new Date(bProp).getTime();
      }

      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });

  return {
    canRevoke,
    confirmEndAllForUser,
    confirmKillSession,
    endAllUsername,
    error,
    fetchSessions,
    filteredSessions,
    handleEndAllForUser,
    handleKillSession,
    isEndingAll,
    isLoading,
    sessionToKill,
    sessions,
    setEndAllUsername,
    setUserToEndAll,
    setFilterType,
    setSearchQuery,
    setShowKillConfirm,
    setSortBy,
    setSortOrder,
    showKillConfirm,
    filterType,
    searchQuery,
    sortBy,
    sortOrder,
    userToEndAll,
  };
}

export default function SessionManagementTab(props: SessionManagementTabProps) {
  const {
    canRevoke,
    confirmEndAllForUser,
    confirmKillSession,
    endAllUsername,
    error,
    fetchSessions,
    filteredSessions,
    handleEndAllForUser,
    handleKillSession,
    isEndingAll,
    isLoading,
    sessionToKill,
    sessions,
    setEndAllUsername,
    setUserToEndAll,
    setFilterType,
    setSearchQuery,
    setShowKillConfirm,
    setSortBy,
    setSortOrder,
    showKillConfirm,
    filterType,
    searchQuery,
    sortBy,
    sortOrder,
    userToEndAll,
  } = useSessionManagement(props);

  if (isLoading && sessions.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 flex justify-center">
            <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Loading sessions...</span>
            </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Active Sessions</h2>
          <p className="text-muted-foreground">
            Monitor and manage user sessions - {filteredSessions.length} active session{filteredSessions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {canRevoke && <div className="flex items-center gap-2">
            <Input
              placeholder="username to end all sessions"
              value={endAllUsername}
              onChange={(e) => setEndAllUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && endAllUsername.trim()) confirmEndAllForUser();
              }}
              className="w-56"
              aria-label="Username to end all sessions for"
            />
            <Button
              variant="outline"
              className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={isLoading || isEndingAll || !endAllUsername.trim()}
              onClick={confirmEndAllForUser}
            >
              <UserX className="w-4 h-4" />
              End all
            </Button>
          </div>}
          <Button
            onClick={fetchSessions}
            disabled={isLoading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
         <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="space-y-2">
               <label className="text-sm font-medium" htmlFor="session-search">Search</label>
               <div className="relative">
                  <Input 
                      id="session-search"
                      placeholder="Username, IP, browser..."
                     value={searchQuery}
                     onChange={(e) => setSearchQuery(e.target.value)}
                     className="pl-8"
                  />
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
               </div>
            </div>

            <div className="space-y-2">
               <label className="text-sm font-medium" htmlFor="session-filter-type">Filter Type</label>
               <Select value={filterType} onValueChange={setFilterType}>
                   <SelectTrigger id="session-filter-type">
                     <SelectValue placeholder="All Sessions" />
                  </SelectTrigger>
                  <SelectContent>
                     <SelectItem value="all">All Sessions</SelectItem>
                     <SelectItem value="admin">Admin Only</SelectItem>
                     <SelectItem value="user">Users Only</SelectItem>
                  </SelectContent>
               </Select>
            </div>

            <div className="space-y-2">
               <label className="text-sm font-medium" htmlFor="session-sort-by">Sort By</label>
               <Select value={sortBy} onValueChange={setSortBy}>
                   <SelectTrigger id="session-sort-by">
                     <SelectValue placeholder="Sort By" />
                  </SelectTrigger>
                  <SelectContent>
                     <SelectItem value="lastActivity">Last Activity</SelectItem>
                     <SelectItem value="createdAt">Created At</SelectItem>
                     <SelectItem value="username">Username</SelectItem>
                  </SelectContent>
               </Select>
            </div>

            <div className="space-y-2">
               <label className="text-sm font-medium" htmlFor="session-sort-order">Order</label>
               <Select value={sortOrder} onValueChange={setSortOrder}>
                   <SelectTrigger id="session-sort-order">
                     <SelectValue placeholder="Order" />
                  </SelectTrigger>
                  <SelectContent>
                     <SelectItem value="desc">Newest First</SelectItem>
                     <SelectItem value="asc">Oldest First</SelectItem>
                  </SelectContent>
               </Select>
            </div>
         </CardContent>
      </Card>

      <Card>
         <Table>
            <TableHeader>
               <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Device/Browser</TableHead>
                  <TableHead>IP Address</TableHead>
                  <TableHead>Last Activity</TableHead>
                  <TableHead>Expires In</TableHead>
                  {canRevoke && <TableHead>Actions</TableHead>}
               </TableRow>
            </TableHeader>
            <TableBody>
               {filteredSessions.length === 0 ? (
                  <TableRow>
                     <TableCell colSpan={canRevoke ? 7 : 6} className="h-24 text-center text-muted-foreground">
                        No active sessions found
                     </TableCell>
                  </TableRow>
               ) : (
                  filteredSessions.map((session) => {
                     const { browser, os } = parseUserAgent(session.userAgent);
                     const isMobile = os === 'iOS' || os === 'Android';
                     
                     return (
                        <TableRow key={session.id}>
                           <TableCell>
                              <div className="font-medium">{session.username}</div>
                              <div className="text-xs text-muted-foreground">Created {formatTimestamp(session.createdAt)}</div>
                           </TableCell>
                           <TableCell>
                              {session.isAdmin ? (
                                 <Badge variant="secondary" className="bg-purple-100 dark:bg-purple-950/60 text-purple-800 hover:bg-purple-200 border-purple-200 dark:border-purple-900">Admin</Badge>
                              ) : (
                                 <Badge variant="outline" className="bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-200 border-green-200 dark:border-green-900">User</Badge>
                              )}
                           </TableCell>
                           <TableCell>
                              <div className="flex items-center gap-2">
                                 {isMobile ? <Smartphone className="w-4 h-4 text-muted-foreground" /> : <Monitor className="w-4 h-4 text-muted-foreground" />}
                                 <div className="flex flex-col">
                                    <span className="text-sm">{browser}</span>
                                    <span className="text-xs text-muted-foreground">{os}</span>
                                 </div>
                              </div>
                           </TableCell>
                           <TableCell>
                              <div className="flex items-center gap-2 text-sm">
                                 <Globe className="w-3 h-3 text-muted-foreground" />
                                 {session.ipAddress || 'Unknown'}
                              </div>
                           </TableCell>
                           <TableCell>
                              <span className="text-sm">{formatTimestamp(session.lastActivity)}</span>
                           </TableCell>
                           <TableCell>
                              <span className="text-sm font-mono text-muted-foreground">{getTimeRemaining(session.expiresAt)}</span>
                           </TableCell>
                           {canRevoke && <TableCell>
                              <Button 
                                 variant="ghost" 
                                 size="sm" 
                                 onClick={() => confirmKillSession(session.id, session.username)}
                                 className="text-red-600 hover:text-red-700 dark:hover:text-red-200 dark:text-red-200 hover:bg-red-50 dark:bg-red-950/40"
                              >
                                 <Trash2 className="w-4 h-4 mr-1" /> Kill
                              </Button>
                           </TableCell>}
                        </TableRow>
                     );
                  })
               )}
            </TableBody>
         </Table>
      </Card>

      <AlertDialog open={showKillConfirm} onOpenChange={setShowKillConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Terminate Session?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to terminate the session for user &quot;{sessionToKill?.username}&quot;?
              The portal session will be revoked immediately. The identity provider will also be asked
              to destroy its session; the result will be reported separately if that backchannel step fails.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleKillSession();
              }}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Terminate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={userToEndAll !== null} onOpenChange={(open) => { if (!open) setUserToEndAll(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End all sessions for &quot;{userToEndAll}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              This revokes every portal session for this user and requests identity-provider
              session destruction through backchannel logout. The result reports any provider
              session that could not be confirmed destroyed. You cannot target your own account - sign out instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isEndingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleEndAllForUser();
              }}
              disabled={isEndingAll}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isEndingAll ? 'Ending…' : 'End all sessions'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
