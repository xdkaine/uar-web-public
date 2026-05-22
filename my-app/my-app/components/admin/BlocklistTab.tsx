import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import { useToast } from '@/hooks/useToast';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Label } from "@/components/ui/label";
import { 
  Ban, 
  Search, 
  Plus, 
  Edit, 
  Trash2, 
  Power, 
  PowerOff,
  ExternalLink 
} from "lucide-react";

interface BlockedEmail {
  id: string;
  createdAt: string;
  updatedAt: string;
  email: string;
  reason: string;
  notes: string | null;
  linkedTicketId: string | null;
  blockedBy: string;
  isActive: boolean;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  deactivationNotes: string | null;
}

interface BlockedEmailFormData {
  email: string;
  reason: string;
  notes: string;
  linkedTicketId: string;
}

export default function BlocklistTab() {
  const [blockedEmails, setBlockedEmails] = useState<BlockedEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedBlock, setSelectedBlock] = useState<BlockedEmail | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [formData, setFormData] = useState<BlockedEmailFormData>({
    email: '',
    reason: '',
    notes: '',
    linkedTicketId: '',
  });

  const [deactivationNotes, setDeactivationNotes] = useState('');
  
  // Delete confirmation state
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [blockToDelete, setBlockToDelete] = useState<string | null>(null);
  
  const { showToast } = useToast();

  useEffect(() => {
    fetchBlockedEmails();
  }, [filterStatus, debouncedSearchQuery]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  // Debounced search handler
  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearchQuery(value);
    }, 300);
  }, []);

  const fetchBlockedEmails = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filterStatus !== 'active') params.append('includeInactive', 'true');
      if (debouncedSearchQuery) params.append('search', debouncedSearchQuery);
      
      const response = await fetch(`/api/admin/blocklist?${params}`);
      if (!response.ok) throw new Error('Failed to fetch blocked emails');
      const data = await response.json();
      setBlockedEmails(data.blockedEmails);
    } catch (error) {
      console.error('Error fetching blocked emails:', error);
      showToast('Failed to load blocked emails', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleAddBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetchWithCsrf('/api/admin/blocklist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: formData.email,
          reason: formData.reason,
          notes: formData.notes || null,
          linkedTicketId: formData.linkedTicketId || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to block email');
      }

      showToast('Email blocked successfully', 'success');
      setShowAddModal(false);
      setFormData({ email: '', reason: '', notes: '', linkedTicketId: '' });
      fetchBlockedEmails();
    } catch (error: any) {
      console.error('Error blocking email:', error);
      showToast(error.message || 'Failed to block email', 'error');
    }
  };

  const handleUpdateBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBlock) return;

    try {
      const response = await fetchWithCsrf(`/api/admin/blocklist/${selectedBlock.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason: formData.reason,
          notes: formData.notes || null,
          linkedTicketId: formData.linkedTicketId || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update block');
      }

      showToast('Block updated successfully', 'success');
      setShowEditModal(false);
      setSelectedBlock(null);
      fetchBlockedEmails();
    } catch (error: any) {
      console.error('Error updating block:', error);
      showToast(error.message || 'Failed to update block', 'error');
    }
  };

  const handleToggleActive = async (block: BlockedEmail) => {
    const newActiveState = !block.isActive;
    const notes = newActiveState ? '' : deactivationNotes;

    try {
      const response = await fetchWithCsrf(`/api/admin/blocklist/${block.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isActive: newActiveState,
          deactivationNotes: notes || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to toggle block status');
      }

      showToast(
        newActiveState ? 'Email block reactivated' : 'Email block deactivated',
        'success'
      );
      setDeactivationNotes('');
      fetchBlockedEmails();
    } catch (error: any) {
      console.error('Error toggling block:', error);
      showToast(error.message || 'Failed to toggle block status', 'error');
    }
  };

  const confirmDeleteBlock = (id: string) => {
    setBlockToDelete(id);
    setShowDeleteConfirm(true);
  };

  const handleDeleteBlock = async () => {
    if (!blockToDelete) return;

    try {
      const response = await fetchWithCsrf(`/api/admin/blocklist/${blockToDelete}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete block');
      }

      showToast('Block deleted successfully', 'success');
      fetchBlockedEmails();
    } catch (error: any) {
      console.error('Error deleting block:', error);
      showToast(error.message || 'Failed to delete block', 'error');
    } finally {
      setShowDeleteConfirm(false);
      setBlockToDelete(null);
    }
  };

  const openEditModal = (block: BlockedEmail) => {
    setSelectedBlock(block);
    setFormData({
      email: block.email,
      reason: block.reason,
      notes: block.notes || '',
      linkedTicketId: block.linkedTicketId || '',
    });
    setShowEditModal(true);
  };

  const totalBlocked = blockedEmails.length;
  const activeBlocked = blockedEmails.filter(b => b.isActive).length;
  const inactiveBlocked = blockedEmails.filter(b => !b.isActive).length;

  const filteredEmails = blockedEmails.filter(block => {
    if (filterStatus === 'active') return block.isActive;
    if (filterStatus === 'inactive') return !block.isActive;
    return true;
  });

  if (loading) {
    return (
      <div className="bg-white p-6 sm:p-8 rounded-lg shadow-xl border-2 border-gray-200 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto"></div>
        <p className="mt-4 text-gray-600">Loading blocked emails...</p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="text-gray-600 text-xs sm:text-sm font-medium">Total Blocked</div>
            <div className="text-2xl sm:text-3xl font-bold text-gray-900 mt-2">{totalBlocked}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="text-gray-600 text-xs sm:text-sm font-medium">Active Blocks</div>
            <div className="text-2xl sm:text-3xl font-bold text-red-500 mt-2">{activeBlocked}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="text-gray-600 text-xs sm:text-sm font-medium">Inactive Blocks</div>
            <div className="text-2xl sm:text-3xl font-bold text-gray-600 mt-2">{inactiveBlocked}</div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 mb-4 sm:mb-6 flex-wrap">
        {(['all', 'active', 'inactive'] as const).map((f) => (
          <Button
            key={f}
            variant={filterStatus === f ? "default" : "outline"}
            onClick={() => setFilterStatus(f)}
            className="capitalize"
          >
            {f}
          </Button>
        ))}
        <div className="relative flex-1 min-w-[200px]">
          <Input
            type="text"
            placeholder="Search emails, reasons, or notes..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
        </div>
        <Button
          onClick={() => setShowAddModal(true)}
          className="bg-red-600 hover:bg-red-700 text-white gap-2"
        >
          <Ban className="h-4 w-4" />
          Block Email
        </Button>
      </div>

      <div className="bg-white rounded-lg overflow-hidden shadow-xl border-2 border-gray-200">
        {filteredEmails.length === 0 ? (
          <div className="p-6 sm:p-8 text-center text-gray-600">
            No {filterStatus !== 'all' ? filterStatus : ''} blocked emails found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-gray-50">
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Blocked By</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEmails.map((block) => (
                  <TableRow key={block.id} className="hover:bg-gray-50">
                    <TableCell className="font-medium text-gray-900">
                      {block.email}
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {block.reason}
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {block.notes || '-'}
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {block.blockedBy}
                      <br />
                      <span className="text-xs text-gray-500">
                        {new Date(block.createdAt).toLocaleDateString()}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          block.isActive
                            ? 'bg-red-100 text-red-800'
                            : 'bg-gray-100 text-gray-800'
                        }`}
                      >
                        {block.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEditModal(block)}
                          className="text-blue-600 hover:text-blue-800 hover:bg-blue-50"
                        >
                          <Edit className="h-4 w-4 mr-1" />
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(block)}
                          className={block.isActive ? 'text-yellow-600 hover:text-yellow-800 hover:bg-yellow-50' : 'text-green-600 hover:text-green-800 hover:bg-green-50'}
                        >
                          {block.isActive ? (
                            <>
                              <PowerOff className="h-4 w-4 mr-1" />
                              Deactivate
                            </>
                          ) : (
                            <>
                              <Power className="h-4 w-4 mr-1" />
                              Reactivate
                            </>
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => confirmDeleteBlock(block.id)}
                          className="text-red-600 hover:text-red-800 hover:bg-red-50"
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete
                        </Button>
                        {block.linkedTicketId && (
                          <Button
                            variant="ghost"
                            size="sm"
                            asChild
                            className="text-purple-600 hover:text-purple-800 hover:bg-purple-50"
                          >
                            <a href={`/admin#ticket-${block.linkedTicketId}`}>
                              <ExternalLink className="h-4 w-4 mr-1" />
                              Ticket
                            </a>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Block Email Address</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddBlock} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address <span className="text-red-500">*</span></Label>
              <Input
                id="email"
                type="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="user@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="reason">Reason <span className="text-red-500">*</span></Label>
              <Input
                id="reason"
                type="text"
                required
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="Brief reason for blocking"
                maxLength={500}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Additional Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Additional details..."
                rows={3}
                maxLength={2000}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="ticketId">Linked Support Ticket ID</Label>
              <Input
                id="ticketId"
                type="text"
                value={formData.linkedTicketId}
                onChange={(e) => setFormData({ ...formData, linkedTicketId: e.target.value })}
                placeholder="Optional ticket ID"
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAddModal(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive">
                Block Email
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditModal} onOpenChange={setShowEditModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Blocked Email</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateBlock} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email Address</Label>
              <Input
                id="edit-email"
                type="email"
                disabled
                value={formData.email}
                className="bg-gray-100"
              />
              <p className="text-xs text-gray-500">Email cannot be changed</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-reason">Reason <span className="text-red-500">*</span></Label>
              <Input
                id="edit-reason"
                type="text"
                required
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                maxLength={500}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-notes">Additional Notes</Label>
              <Textarea
                id="edit-notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                rows={3}
                maxLength={2000}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-ticketId">Linked Support Ticket ID</Label>
              <Input
                id="edit-ticketId"
                type="text"
                value={formData.linkedTicketId}
                onChange={(e) => setFormData({ ...formData, linkedTicketId: e.target.value })}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowEditModal(false)}>
                Cancel
              </Button>
              <Button type="submit">
                Update Block
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Block?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete this block? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={(e) => {
                e.preventDefault();
                handleDeleteBlock();
              }}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
