'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/hooks/useToast';
import { fetchWithCsrf } from '@/lib/csrf';
import DateTimePicker from '@/components/DateTimePicker';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, RefreshCw } from "lucide-react";

interface ADAccount {
  name: string;
  email?: string;
  ldapUsername: string;
  password: string;
  accountExpiresAt: string;
  isInternal: boolean;
}

interface VPNAccount {
  name: string;
  email?: string;
  vpnUsername: string;
  password: string;
  accountExpiresAt: string;
  portalType: string; // "Management", "Limited", "External"
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

interface BatchAccountsTabProps {
  batches: BatchCreation[];
  supportTickets: Array<{
    id: string;
    subject: string;
    status: string;
  }>;
  onBatchCreated: () => void;
}

export default function BatchAccountsTab({
  batches,
  supportTickets,
  onBatchCreated
}: BatchAccountsTabProps) {
  const router = useRouter();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [description, setDescription] = useState('');
  const [linkedTicketId, setLinkedTicketId] = useState('');
  const [adAccounts, setAdAccounts] = useState<ADAccount[]>([]);
  const [vpnAccounts, setVpnAccounts] = useState<VPNAccount[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { showToast } = useToast();

  const addAdAccount = () => {
    if (adAccounts.length + vpnAccounts.length >= 100) {
      showToast('Maximum 100 total accounts per batch', 'error');
      return;
    }
    setAdAccounts([
      ...adAccounts,
      {
        name: '',
        email: '',
        ldapUsername: '',
        password: '',
        accountExpiresAt: '',
        isInternal: true,
      },
    ]);
  };

  const removeAdAccount = (index: number) => {
    setAdAccounts(adAccounts.filter((_, i) => i !== index));
  };

  const updateAdAccount = (index: number, field: keyof ADAccount, value: string | boolean) => {
    const newAccounts = [...adAccounts];
    newAccounts[index] = { ...newAccounts[index], [field]: value };
    setAdAccounts(newAccounts);
  };

  const generateAdPassword = (index: number) => {
    const length = 16;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    updateAdAccount(index, 'password', password);
  };

  const addVpnAccount = () => {
    if (adAccounts.length + vpnAccounts.length >= 100) {
      showToast('Maximum 100 total accounts per batch', 'error');
      return;
    }
    setVpnAccounts([
      ...vpnAccounts,
      {
        name: '',
        email: '',
        vpnUsername: '',
        password: '',
        accountExpiresAt: '',
        portalType: 'External',
      },
    ]);
  };

  const removeVpnAccount = (index: number) => {
    const newAccounts = vpnAccounts.filter((_, i) => i !== index);
    setVpnAccounts(newAccounts);
  };

  const updateVpnAccount = (index: number, field: keyof VPNAccount, value: string) => {
    const newAccounts = [...vpnAccounts];
    newAccounts[index] = { ...newAccounts[index], [field]: value };
    setVpnAccounts(newAccounts);
  };

  const generateVpnPassword = (index: number) => {
    const length = 16;
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    updateVpnAccount(index, 'password', password);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate
    if (!description.trim()) {
      showToast('Description is required', 'error');
      return;
    }

    if (adAccounts.length === 0) {
      showToast('At least one AD account is required', 'error');
      return;
    }

    // Validate AD accounts
    for (const account of adAccounts) {
      if (!account.name || !account.ldapUsername || !account.password) {
        showToast('All AD accounts must have name, username, and password', 'error');
        return;
      }
      if (!account.isInternal && !account.accountExpiresAt) {
        showToast('External AD accounts require an expiration date', 'error');
        return;
      }
    }

    // Validate VPN accounts
    for (const account of vpnAccounts) {
      if (!account.name || !account.vpnUsername || !account.password) {
        showToast('All VPN accounts must have name, username, and password', 'error');
        return;
      }
      if (!account.accountExpiresAt) {
        showToast('VPN accounts require an expiration date', 'error');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const response = await fetchWithCsrf('/api/admin/batch-accounts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          description,
          linkedTicketId: linkedTicketId || undefined,
          adAccounts,
          vpnAccounts,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create batch');
      }

      showToast(
        `Batch created successfully! ${data.summary.successful} successful, ${data.summary.failed} failed`,
        data.summary.failed > 0 ? 'warning' : 'success'
      );

      setShowCreateForm(false);
      setDescription('');
      setLinkedTicketId('');
      setAdAccounts([]);
      setVpnAccounts([]);
      onBatchCreated();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to create batch', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const styles = {
      processing: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
      failed: 'bg-red-100 text-red-800',
    };

    return (
      <span className={`px-3 py-1 rounded-full text-sm font-semibold ${styles[status as keyof typeof styles] || 'bg-gray-100 text-gray-800'}`}>
        {status}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold tracking-tight">Batch Account Creation</h2>
        <Button
          onClick={() => setShowCreateForm(!showCreateForm)}
          variant={showCreateForm ? "secondary" : "default"}
        >
          {showCreateForm ? 'Cancel' : 'Create Batch'}
        </Button>
      </div>

      {showCreateForm && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-bold">Create New Batch</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="grid gap-3">
                <Label htmlFor="description">
                  Description <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g., Conference attendees batch #1"
                  required
                />
              </div>

              <div className="grid gap-3">
                <Label htmlFor="ticket">
                  Link to Support Ticket (Optional)
                </Label>
                <Select
                  value={linkedTicketId}
                  onValueChange={setLinkedTicketId}
                >
                  <SelectTrigger id="ticket">
                    <SelectValue placeholder="Select a ticket (Optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {supportTickets.map((ticket) => (
                      <SelectItem key={ticket.id} value={ticket.id}>
                        {ticket.subject} - {ticket.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="border-t pt-6">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h4 className="text-lg font-bold">AD Accounts ({adAccounts.length})</h4>
                    <p className="text-sm text-gray-600 mt-1">Required - Add at least one AD account</p>
                  </div>
                  <Button
                    type="button"
                    onClick={addAdAccount}
                    disabled={adAccounts.length + vpnAccounts.length >= 100}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add AD Account
                  </Button>
                </div>

                {adAccounts.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                    <p className="text-sm">No AD accounts added</p>
                    <p className="text-xs mt-1">Click &ldquo;Add AD Account&rdquo; above to add at least one account</p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
                    {adAccounts.map((account, index) => (
                      <Card key={index} className="border-blue-200 bg-blue-50/30">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-semibold text-sm text-gray-700">AD Account {index + 1}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeAdAccount(index)}
                              className="text-red-600 hover:text-red-800 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Remove
                            </Button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs font-semibold text-gray-600 mb-1">
                                Full Name *
                              </Label>
                              <Input
                                type="text"
                                value={account.name}
                                onChange={(e) => updateAdAccount(index, 'name', e.target.value)}
                                className="bg-white"
                                required
                              />
                            </div>

                            <div>
                              <Label className="text-xs font-semibold text-gray-600 mb-1">
                                Email <span className="text-gray-400 font-normal">(Optional)</span>
                              </Label>
                              <Input
                                type="email"
                                value={account.email}
                                onChange={(e) => updateAdAccount(index, 'email', e.target.value)}
                                className="bg-white"
                              />
                            </div>

                            <div>
                              <Label className="text-xs font-semibold text-gray-600 mb-1">
                                AD Username *
                              </Label>
                              <Input
                                type="text"
                                value={account.ldapUsername}
                                onChange={(e) => updateAdAccount(index, 'ldapUsername', e.target.value)}
                                className="bg-white"
                                required
                              />
                            </div>

                            <div>
                              <Label className="text-xs font-semibold text-gray-600 mb-1">
                                Password *
                              </Label>
                              <div className="flex gap-2">
                                <Input
                                  type="text"
                                  value={account.password}
                                  onChange={(e) => updateAdAccount(index, 'password', e.target.value)}
                                  className="bg-white"
                                  required
                                />
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="icon"
                                  onClick={() => generateAdPassword(index)}
                                  title="Generate Password"
                                >
                                  <RefreshCw className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            <div>
                              <DateTimePicker
                                label={`Expiration Date ${!account.isInternal ? '*' : ''}`}
                                value={account.accountExpiresAt}
                                onChange={(datetime) => updateAdAccount(index, 'accountExpiresAt', datetime)}
                                required={!account.isInternal}
                                placeholder="Select expiration date/time"
                              />
                            </div>

                            <div className="flex items-center pt-6">
                              <div className="flex items-center space-x-2">
                                <Checkbox
                                  id={`internal-${index}`}
                                  checked={account.isInternal}
                                  onCheckedChange={(checked) => updateAdAccount(index, 'isInternal', checked as boolean)}
                                />
                                <Label htmlFor={`internal-${index}`} className="font-semibold cursor-pointer">
                                  Internal User
                                </Label>
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t pt-6">
                <div className="flex justify-between items-center mb-4">
                  <div>
                    <h4 className="text-lg font-bold">VPN Accounts ({vpnAccounts.length})</h4>
                    <p className="text-sm text-gray-600 mt-1">Optional - Add VPN accounts if needed</p>
                  </div>
                  <Button
                    type="button"
                    onClick={addVpnAccount}
                    disabled={adAccounts.length + vpnAccounts.length >= 100}
                    className="bg-green-600 hover:bg-green-700 text-white"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Add VPN Account
                  </Button>
                </div>

                {vpnAccounts.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                    <p className="text-sm">No VPN accounts added</p>
                    <p className="text-xs mt-1">Click &ldquo;Add VPN Account&rdquo; above to add VPN accounts</p>
                  </div>
                ) : (
                  <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
                    {vpnAccounts.map((account, index) => (
                      <Card key={index} className="border-green-200 bg-green-50/30">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex justify-between items-center mb-2">
                            <span className="font-semibold text-sm text-gray-700">VPN Account {index + 1}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeVpnAccount(index)}
                              className="text-red-600 hover:text-red-800 hover:bg-red-50"
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Remove
                            </Button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div>
                              <Label className="text-xs font-semibold text-gray-600 mb-1">
                                Full Name *
                              </Label>
                              <Input
                                type="text"
                                value={account.name}
                                onChange={(e) => updateVpnAccount(index, 'name', e.target.value)}
                                className="bg-white"
                                required
                              />
                            </div>

                            <div>
                              <Label className="text-xs font-semibold text-gray-600 mb-1">
                                Email <span className="text-gray-400 font-normal">(Optional)</span>
                              </Label>
                              <Input
                                type="email"
                                value={account.email}
                                onChange={(e) => updateVpnAccount(index, 'email', e.target.value)}
                                className="bg-white"
                              />
                            </div>

                            <div>
                              <Label className="text-xs font-semibold text-gray-600 mb-1">
                                VPN Username *
                              </Label>
                              <Input
                                type="text"
                                value={account.vpnUsername}
                                onChange={(e) => updateVpnAccount(index, 'vpnUsername', e.target.value)}
                                className="bg-white"
                                required
                              />
                            </div>

                            <div>
                              <Label className="text-xs font-semibold text-gray-600 mb-1">
                                Password *
                              </Label>
                              <div className="flex gap-2">
                                <Input
                                  type="text"
                                  value={account.password}
                                  onChange={(e) => updateVpnAccount(index, 'password', e.target.value)}
                                  className="bg-white"
                                  required
                                />
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="icon"
                                  onClick={() => generateVpnPassword(index)}
                                  title="Generate Password"
                                >
                                  <RefreshCw className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>

                            <div>
                              <Label className="text-xs font-semibold text-gray-600 mb-1">
                                Portal Type *
                              </Label>
                              <Select
                                value={account.portalType}
                                onValueChange={(value) => updateVpnAccount(index, 'portalType', value)}
                              >
                                <SelectTrigger className="bg-white">
                                  <SelectValue placeholder="Select portal type" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="Management">Internal - Management</SelectItem>
                                  <SelectItem value="Limited">Internal - Limited</SelectItem>
                                  <SelectItem value="External">External</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <DateTimePicker
                                label="Expiration Date *"
                                value={account.accountExpiresAt}
                                onChange={(datetime) => updateVpnAccount(index, 'accountExpiresAt', datetime)}
                                required
                                placeholder="Select expiration date/time"
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowCreateForm(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || (adAccounts.length === 0)}
                >
                  {isSubmitting ? 'Creating...' : `Create ${adAccounts.length + vpnAccounts.length} Account${adAccounts.length + vpnAccounts.length !== 1 ? 's' : ''}`}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="bg-gray-50/50 border-b">
          <CardTitle className="text-lg font-bold">Batch History</CardTitle>
        </CardHeader>

        {batches.length === 0 ? (
          <CardContent className="p-8 text-center text-gray-500">
            No batch operations yet
          </CardContent>
        ) : (
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Created By</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Linked Ticket</TableHead>
                <TableHead>Total</TableHead>
                <TableHead>Successful</TableHead>
                <TableHead>Failed</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {batches.map((batch) => (
                <TableRow key={batch.id} className="hover:bg-gray-50">
                  <TableCell className="text-sm">
                    {new Date(batch.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {batch.createdBy}
                  </TableCell>
                  <TableCell>
                    {batch.description}
                  </TableCell>
                  <TableCell>
                    {batch.linkedTicket ? (
                      <div>
                        <div className="font-medium">{batch.linkedTicket.subject}</div>
                        <div className="text-xs text-gray-500">{batch.linkedTicket.status}</div>
                      </div>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="font-semibold">
                    {batch.totalAccounts}
                  </TableCell>
                  <TableCell>
                    <span className="text-green-600 font-semibold">{batch.successfulAccounts}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-red-600 font-semibold">{batch.failedAccounts}</span>
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(batch.status)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="link"
                      onClick={() => router.push(`/admin/batch-accounts/${batch.id}`)}
                      className="text-black font-semibold p-0 h-auto"
                    >
                      View Details
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
