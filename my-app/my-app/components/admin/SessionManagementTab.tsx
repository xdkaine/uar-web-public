'use client';

import { useState, useEffect } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RefreshCw, Search, Monitor, Smartphone, Globe, AlertTriangle, Trash2 } from "lucide-react";
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

export default function SessionManagementTab({ isLoading: initialLoading = false, onRefresh }: SessionManagementTabProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(initialLoading);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('lastActivity');
  const [sortOrder, setSortOrder] = useState<string>('desc');
  const [error, setError] = useState<string | null>(null);
  const { showToast } = useToast();
  
  // Confirmation state
  const [sessionToKill, setSessionToKill] = useState<{id: string, username: string} | null>(null);
  const [showKillConfirm, setShowKillConfirm] = useState(false);

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

  useEffect(() => {
    fetchSessions();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchSessions, 30000);
    return () => clearInterval(interval);
  }, []);

  const confirmKillSession = (id: string, username: string) => {
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

      showToast(`Successfully terminated session for ${sessionToKill.username}`, "success");

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

      // @ts-ignore - dynamic access
      const aProp = a[sortBy];
      // @ts-ignore - dynamic access
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
        <Button
          onClick={fetchSessions}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
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
               <label className="text-sm font-medium">Search</label>
               <div className="relative">
                  <Input 
                     placeholder="Username, IP, browser..." 
                     value={searchQuery}
                     onChange={(e) => setSearchQuery(e.target.value)}
                     className="pl-8"
                  />
                  <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-muted-foreground" />
               </div>
            </div>

            <div className="space-y-2">
               <label className="text-sm font-medium">Filter Type</label>
               <Select value={filterType} onValueChange={setFilterType}>
                  <SelectTrigger>
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
               <label className="text-sm font-medium">Sort By</label>
               <Select value={sortBy} onValueChange={setSortBy}>
                  <SelectTrigger>
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
               <label className="text-sm font-medium">Order</label>
               <Select value={sortOrder} onValueChange={setSortOrder}>
                  <SelectTrigger>
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
                  <TableHead>Actions</TableHead>
               </TableRow>
            </TableHeader>
            <TableBody>
               {filteredSessions.length === 0 ? (
                  <TableRow>
                     <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
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
                                 <Badge variant="secondary" className="bg-purple-100 text-purple-800 hover:bg-purple-200 border-purple-200">Admin</Badge>
                              ) : (
                                 <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">User</Badge>
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
                           <TableCell>
                              <Button 
                                 variant="ghost" 
                                 size="sm" 
                                 onClick={() => confirmKillSession(session.id, session.username)}
                                 className="text-red-600 hover:text-red-700 hover:bg-red-50"
                              >
                                 <Trash2 className="w-4 h-4 mr-1" /> Kill
                              </Button>
                           </TableCell>
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
              Are you sure you want to terminate the session for user "{sessionToKill?.username}"? 
              They will be logged out immediately.
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
    </div>
  );
}
