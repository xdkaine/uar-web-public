'use client';

import { useState, useCallback, useEffect, useRef, useId } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { useToast } from '@/hooks/useToast';
import { fetchJson } from '@/lib/client-query';
import MassEmailComposer from '@/components/admin/MassEmailComposer';
import { Card, CardContent } from "@/components/ui/card";
import CommunicationsRecipientActions from '@/components/admin/CommunicationsRecipientActions';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Search } from "lucide-react";
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

interface SearchResult {
    id: string;
    type: string;
    name?: string;
    email?: string;
    username?: string;
    status?: string;
    createdAt: string;
    displayName?: string;
}

interface ConfirmDialogState {
    isOpen: boolean;
    title: string;
    description: string;
    actionEndpoint: string;
}

export default function CommunicationsTab() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const searchInputId = useId();
    const [searchQuery, setSearchQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
        isOpen: false,
        title: '',
        description: '',
        actionEndpoint: '',
    });

    const { showToast } = useToast();
    const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => () => {
        if (typingTimeout.current !== null) {
            clearTimeout(typingTimeout.current);
        }
    }, []);
    const selectedView = searchParams.get('view') === 'manual-notifications'
        ? 'manual-notifications'
        : 'mass-email';
    const selectedWorkspace = searchParams.get('workspace') === 'campaigns'
        ? 'campaigns'
        : 'compose';

    const replaceLocation = useCallback((view: string, workspace?: string) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('view', view);
        if (workspace) params.set('workspace', workspace);
        router.replace(`/admin/communications?${params.toString()}`, { scroll: false });
    }, [router, searchParams]);

    const { data: csrfData } = useSWR<{ csrfToken: string }>('/api/csrf-token', fetchJson);
    const csrfToken = csrfData?.csrfToken ?? null;

    const handleSearch = useCallback(async (query: string) => {
        if (!query || query.length < 2) {
            setResults([]);
            return;
        }

        setIsSearching(true);
        try {
            // Use the 'requests' type filter to narrow down relevant entities for communications
            const res = await fetch(`/api/admin/search?q=${encodeURIComponent(query)}&type=requests`);
            if (!res.ok) throw new Error('Search failed');
            const data = await res.json();
            setResults(data.accessRequests || []);
        } catch (error) {
            console.error('Search error:', error);
            showToast('Failed to perform search', 'error');
        } finally {
            setIsSearching(false);
        }
    }, [showToast]);

    const onSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const query = e.target.value;
        setSearchQuery(query);

        if (typingTimeout.current !== null) {
            clearTimeout(typingTimeout.current);
        }

        typingTimeout.current = setTimeout(() => {
            typingTimeout.current = null;
            handleSearch(query);
        }, 500);
    };

    const initiateAction = (endpoint: string, title: string, description: string) => {
        if (!selectedItem) return;
        setConfirmDialog({
            isOpen: true,
            title,
            description,
            actionEndpoint: endpoint,
        });
    };

    const executeAction = async () => {
        if (!confirmDialog.actionEndpoint) return;

        // Ensure we have a token. If not, try to fetch it one last time or fail.
        let token = csrfToken;
        if (!token) {
            try {
                const res = await fetch('/api/csrf-token', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    token = data.csrfToken;
                }
            } catch {
                console.error("Failed to recover CSRF token");
            }
        }

        if (!token) {
            showToast('Security token missing. Please refresh the page.', 'error');
            setConfirmDialog(prev => ({ ...prev, isOpen: false }));
            return;
        }

        setActionLoading(true);
        // Close dialog immediately
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));

        try {
            const res = await fetch(confirmDialog.actionEndpoint, {
                method: 'POST',
                headers: {
                    'x-csrf-token': token,
                    'Content-Type': 'application/json'
                }
            });
            const data = await res.json();

            if (res.ok) {
                showToast(data.message || 'Action completed successfully', 'success');
            } else {
                throw new Error(data.error || 'Failed to complete action');
            }
        } catch (error) {
            showToast(error instanceof Error ? error.message : 'Action failed', 'error');
        } finally {
            setActionLoading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h2 className="text-2xl font-bold tracking-tight text-foreground">Communication Center</h2>
                <p className="text-muted-foreground">
                    Manually trigger email notifications for users. Search for a user or request to begin.
                </p>
            </div>

            <Tabs value={selectedView} onValueChange={(view) => replaceLocation(view)} className="space-y-6">
                <TabsList>
                    <TabsTrigger value="mass-email">Mass Email</TabsTrigger>
                    <TabsTrigger value="manual-notifications">Manual Notifications</TabsTrigger>
                </TabsList>

                <TabsContent
                    id="mass-email-workspace"
                    value="mass-email"
                    className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                    <MassEmailComposer
                        activeWorkspace={selectedWorkspace}
                        onWorkspaceChange={(workspace) => replaceLocation('mass-email', workspace)}
                    />
                </TabsContent>

                <TabsContent
                    id="manual-notifications"
                    value="manual-notifications"
                    className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="md:col-span-1 border-2 shadow-sm">
                    <CardContent className="p-4 space-y-4">
                        <label htmlFor={searchInputId} className="block text-sm font-medium">Search recipients</label>
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                            <input
                                id={searchInputId}
                                type="text"
                                placeholder="Search by name, email, or username..."
                                className="w-full pl-9 pr-4 py-2 border rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                                value={searchQuery}
                                onChange={onSearchChange}
                            />
                        </div>

                        <div className="space-y-2 max-h-[600px] overflow-y-auto">
                            {isSearching ? (
                                <p className="text-center text-muted-foreground py-4">Searching...</p>
                            ) : results.length > 0 ? (
                                results.map((result) => (
                                    <button
                                        key={result.id}
                                        type="button"
                                        aria-pressed={selectedItem?.id === result.id}
                                        onClick={() => setSelectedItem(result)}
                                        className={`block w-full p-3 text-left rounded-md cursor-pointer border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${selectedItem?.id === result.id
                                            ? 'bg-blue-50 dark:bg-blue-950/40 border-blue-300'
                                            : 'hover:bg-muted/50 border-border'
                                            }`}
                                    >
                                        <span className="block font-semibold text-foreground">{result.name || 'Unknown Name'}</span>
                                        <span className="block text-sm text-muted-foreground">{result.email}</span>
                                        <span className="flex items-center gap-2 mt-1">
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${result.status === 'approved' ? 'bg-green-100 dark:bg-green-950/60 text-green-800' :
                                                result.status === 'rejected' ? 'bg-red-100 dark:bg-red-950/60 text-red-800' :
                                                    'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800'
                                                }`}>
                                                {result.status}
                                            </span>
                                            {result.username && (
                                                <span className="text-xs font-mono bg-muted text-muted-foreground px-2 py-0.5 rounded-full">
                                                    {result.username}
                                                </span>
                                            )}
                                        </span>
                                    </button>
                                ))
                            ) : searchQuery.length > 1 ? (
                                <p className="text-center text-muted-foreground py-4">No results found</p>
                            ) : (
                                <p className="text-center text-muted-foreground py-4 text-sm">Enter a search term</p>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <CommunicationsRecipientActions
                    selectedItem={selectedItem}
                    actionLoading={actionLoading}
                    initiateAction={initiateAction}
                />
            </div>
                </TabsContent>
            </Tabs>

            <AlertDialog open={confirmDialog.isOpen} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, isOpen: open }))}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmDialog.description}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={executeAction} disabled={actionLoading}>
                            {actionLoading ? 'Processing...' : 'Continue'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
