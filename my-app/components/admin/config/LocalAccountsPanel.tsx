'use client';
import { requestActionImpact } from '@/components/admin/actionImpactRequest';

import { useState, useEffect, useCallback } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Plus, RefreshCw, KeyRound, Power } from 'lucide-react';

interface LocalAccount {
  id: string;
  username: string;
  purpose: string;
  isActive: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
}

export default function LocalAccountsPanel() {
  const [accounts, setAccounts] = useState<LocalAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchAccounts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/config/local-accounts');
      if (!response.ok) throw new Error('Failed to load local accounts');
      const data = await response.json();
      setAccounts(data.accounts ?? []);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAccounts();
  }, [fetchAccounts]);

  const createAccount = async () => {
    setCreating(true);
    setMessage(null);
    try {
      // Break-glass identities live in the reserved @local namespace so they
      // can never collide with an AD account; append it for bare names.
      const trimmed = newUsername.trim().toLowerCase();
      const username = trimmed.includes('@') ? trimmed : `${trimmed}@local`;
      const response = await fetchWithCsrf('/api/admin/config/local-accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password: newPassword }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(
          data?.issues?.length
            ? `${data.error}: ${data.issues.join('; ')}`
            : data?.error || 'Failed to create local account'
        );
      }
      setShowForm(false);
      setNewUsername('');
      setNewPassword('');
      setMessage({ type: 'success', text: 'Break-glass account created. Store the password safely - it is not retrievable. Sign in with the full username, e.g. emergency-admin@local.' });
      await fetchAccounts();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to create local account',
      });
    } finally {
      setCreating(false);
    }
  };

  const patchAccount = async (account: LocalAccount, body: Record<string, unknown>, successText: string) => {
    setBusyId(account.id);
    setMessage(null);
    try {
      const response = await fetchWithCsrf(`/api/admin/config/local-accounts/${account.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to update local account');
      }
      setMessage({ type: 'success', text: successText });
      await fetchAccounts();
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to update local account',
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card id="break-glass-accounts" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Break-Glass Accounts</CardTitle>
            <CardDescription>
              Local emergency accounts that sign in when Active Directory is unreachable
              (ADR-0009). They grant system-administrator authority, are audited on every
              login, and are disabled-by-default when off. Passwords are stored only as
              scrypt hashes and cannot be recovered.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={fetchAccounts} className="gap-2">
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setShowForm((v) => !v)} className="gap-2">
              <Plus className="h-4 w-4" /> New Account
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {message && (
          <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className="mb-4">
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}

        {showForm && (
          <div className="mb-6 space-y-3 rounded-lg border p-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="breakglass-username">Username</Label>
                <Input
                  id="breakglass-username"
                  value={newUsername}
                  onChange={(event) => setNewUsername(event.target.value)}
                  placeholder="emergency-admin (@local is added automatically)"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="breakglass-password">Password</Label>
                <Input
                  id="breakglass-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="Min 12 chars incl. upper, lower, number, special"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <Button size="sm" onClick={createAccount} disabled={creating || !newUsername.trim() || !newPassword}>
              {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Break-Glass Account
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : accounts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No break-glass accounts exist yet.
          </p>
        ) : (
          <div className="space-y-3">
            {accounts.map((account) => (
              <div key={account.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{account.username}</span>
                      <Badge variant={account.isActive ? 'default' : 'secondary'}>
                        {account.isActive ? 'active' : 'disabled'}
                      </Badge>
                      <Badge variant="outline">{account.purpose}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created by {account.createdBy} ·{' '}
                      {account.lastUsedAt
                        ? `Last used ${new Date(account.lastUsedAt).toLocaleString()}${account.lastUsedIp ? ` from ${account.lastUsedIp}` : ''}`
                        : 'Never used'}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === account.id}
                      onClick={async () => {
                        const decision = await requestActionImpact({ title: 'Rotate break-glass password', description: `Set a new password for ${account.username}. Every existing local session for this account will be revoked.`, input: { label: 'New password (min 12 chars, upper/lower/number/special)', type: 'password', required: true }, items: [{ label: 'Account', value: account.username }, { label: 'External effect', value: 'All local sessions are revoked', tone: 'warning' }], confirmLabel: 'Rotate password', destructive: true, evidence: 'The plaintext is never logged or returned after this request; deliver it through the approved break-glass channel.' });
                        if (!decision.confirmed || !decision.value) return;
                        void patchAccount(
                          account,
                          { password: decision.value },
                          `Password rotated for ${account.username}. Share it through your break-glass channel; local sessions were revoked.`
                        );
                      }}
                    >
                      <KeyRound className="h-4 w-4" /> Rotate
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === account.id}
                      onClick={() =>
                        patchAccount(
                          account,
                          { isActive: !account.isActive },
                          account.isActive
                            ? `Disabled ${account.username}. Local sessions revoked.`
                            : `Enabled ${account.username}.`
                        )
                      }
                    >
                      <Power className="h-4 w-4" />
                      {account.isActive ? 'Disable' : 'Enable'}
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
