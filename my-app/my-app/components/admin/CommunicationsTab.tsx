'use client';

import { useState, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/useToast';
import MassEmailComposer from '@/components/admin/MassEmailComposer';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
    const [searchQuery, setSearchQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedItem, setSelectedItem] = useState<SearchResult | null>(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [csrfToken, setCsrfToken] = useState<string | null>(null);
    const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>({
        isOpen: false,
        title: '',
        description: '',
        actionEndpoint: '',
    });

    const { showToast } = useToast();
    const [typingTimeout, setTypingTimeout] = useState<NodeJS.Timeout | null>(null);

    // Fetch CSRF token on mount
    useEffect(() => {
        const fetchCsrfToken = async () => {
            try {
                const res = await fetch('/api/csrf-token', { cache: 'no-store' });
                if (res.ok) {
                    const data = await res.json();
                    setCsrfToken(data.csrfToken);
                }
            } catch (error) {
                console.error('Failed to fetch CSRF token:', error);
            }
        };
        fetchCsrfToken();
    }, []);

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

        if (typingTimeout) {
            clearTimeout(typingTimeout);
        }

        const timeout = setTimeout(() => {
            handleSearch(query);
        }, 500);

        setTypingTimeout(timeout);
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
                    setCsrfToken(data.csrfToken);
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
                <h2 className="text-2xl font-bold tracking-tight text-gray-900">Communication Center</h2>
                <p className="text-gray-500">
                    Manually trigger email notifications for users. Search for a user or request to begin.
                </p>
            </div>

            <Tabs defaultValue="mass-email" className="space-y-6">
                <TabsList>
                    <TabsTrigger value="mass-email">Mass Email</TabsTrigger>
                    <TabsTrigger value="manual-notifications">Manual Notifications</TabsTrigger>
                </TabsList>

                <TabsContent value="mass-email">
                    <MassEmailComposer />
                </TabsContent>

                <TabsContent value="manual-notifications">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="md:col-span-1 border-2 shadow-sm">
                    <CardContent className="p-4 space-y-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Search by name, email, or username..."
                                className="w-full pl-9 pr-4 py-2 border rounded-md focus:outline-hidden focus:ring-2 focus:ring-blue-500"
                                value={searchQuery}
                                onChange={onSearchChange}
                            />
                        </div>

                        <div className="space-y-2 max-h-[600px] overflow-y-auto">
                            {isSearching ? (
                                <p className="text-center text-gray-500 py-4">Searching...</p>
                            ) : results.length > 0 ? (
                                results.map((result) => (
                                    <div
                                        key={result.id}
                                        onClick={() => setSelectedItem(result)}
                                        className={`p-3 rounded-md cursor-pointer border transition-colors ${selectedItem?.id === result.id
                                            ? 'bg-blue-50 border-blue-300'
                                            : 'hover:bg-gray-50 border-gray-100'
                                            }`}
                                    >
                                        <p className="font-semibold text-gray-900">{result.name || 'Unknown Name'}</p>
                                        <p className="text-sm text-gray-500">{result.email}</p>
                                        <div className="flex items-center gap-2 mt-1">
                                            <span className={`text-xs px-2 py-0.5 rounded-full ${result.status === 'approved' ? 'bg-green-100 text-green-800' :
                                                result.status === 'rejected' ? 'bg-red-100 text-red-800' :
                                                    'bg-yellow-100 text-yellow-800'
                                                }`}>
                                                {result.status}
                                            </span>
                                            {result.username && (
                                                <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                                                    {result.username}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                ))
                            ) : searchQuery.length > 1 ? (
                                <p className="text-center text-gray-500 py-4">No results found</p>
                            ) : (
                                <p className="text-center text-gray-400 py-4 text-sm">Enter a search term</p>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="md:col-span-2 border-2 shadow-sm">
                    <CardContent className="p-6">
                        {selectedItem ? (
                            <div className="space-y-6">
                                <div className="border-b pb-4">
                                    <h3 className="text-xl font-bold text-gray-900">{selectedItem.name}</h3>
                                    <div className="mt-1 flex flex-wrap gap-4 text-sm text-gray-600">
                                        <p>Email: <span className="font-medium text-gray-900">{selectedItem.email}</span></p>
                                        {selectedItem.username && (
                                            <p>Username: <span className="font-medium text-gray-900">{selectedItem.username}</span></p>
                                        )}
                                        <p>ID: <span className="font-mono text-xs">{selectedItem.id}</span></p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h4 className="font-semibold text-gray-900">Available Actions</h4>

                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        <div className={`p-4 rounded-lg border-2 ${selectedItem.status === 'pending_verification' ? 'border-yellow-300 bg-yellow-50' : 'border-gray-100 bg-gray-50 opacity-50'}`}>
                                            <h5 className="font-bold text-gray-900 mb-1">Resend Verification Email</h5>
                                            <p className="text-sm text-gray-600 mb-4">Send a new email confirmation link.</p>
                                            <Button
                                                className="w-full"
                                                variant={selectedItem.status === 'pending_verification' ? 'default' : 'outline'}
                                                disabled={selectedItem.status !== 'pending_verification' || actionLoading}
                                                onClick={() => initiateAction(
                                                    `/api/admin/requests/${selectedItem.id}/resend-verification`,
                                                    'Resend Verification?',
                                                    'Are you sure you want to resend the verification email to this user?'
                                                )}
                                            >
                                                Resend Verification
                                            </Button>
                                        </div>

                                        <div className={`p-4 rounded-lg border-2 ${selectedItem.status === 'approved' ? 'border-purple-300 bg-purple-50' : 'border-gray-100 bg-gray-50 opacity-50'}`}>
                                            <h5 className="font-bold text-gray-900 mb-1">Resend Activation Token</h5>
                                            <p className="text-sm text-gray-600 mb-4">Send a new activation link (internal users).</p>
                                            <Button
                                                className="w-full"
                                                variant={selectedItem.status === 'approved' ? 'default' : 'outline'}
                                                disabled={selectedItem.status !== 'approved' || actionLoading}
                                                onClick={() => initiateAction(
                                                    `/api/admin/requests/${selectedItem.id}/resend-activation`,
                                                    'Resend Activation Token?',
                                                    'This will invalidate any previous activation tokens. Continue?'
                                                )}
                                            >
                                                Resend Activation
                                            </Button>
                                        </div>

                                        <div className={`p-4 rounded-lg border-2 ${selectedItem.status === 'approved' && selectedItem.username ? 'border-red-300 bg-red-50' : 'border-gray-100 bg-gray-50 opacity-50'}`}>
                                            <h5 className="font-bold text-gray-900 mb-1">Send Admin Reset Link</h5>
                                            <p className="text-sm text-gray-600 mb-4">Email a one-time AD password reset link for active accounts.</p>
                                            <Button
                                                className="w-full bg-red-600 hover:bg-red-700 text-white"
                                                disabled={!(selectedItem.status === 'approved' && selectedItem.username) || actionLoading}
                                                onClick={() => initiateAction(
                                                    `/api/admin/requests/${selectedItem.id}/reset-password`,
                                                    'Send Admin Reset Link?',
                                                    'Are you sure you want to send an administrator-issued one-time password reset link to this user?'
                                                )}
                                            >
                                                Send Reset Link
                                            </Button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4 py-12">
                                <Search className="h-12 w-12 opacity-20" />
                                <p>Select a user from the results to view actions</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
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
