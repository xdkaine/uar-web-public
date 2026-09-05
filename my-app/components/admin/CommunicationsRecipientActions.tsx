'use client';

import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface CommunicationsRecipientActionsProps {
  selectedItem: {
    id: string;
    name?: string;
    email?: string;
    username?: string;
    status?: string;
  } | null;
  actionLoading: boolean;
  initiateAction: (endpoint: string, title: string, description: string) => void;
}

export default function CommunicationsRecipientActions({
  selectedItem,
  actionLoading,
  initiateAction,
}: CommunicationsRecipientActionsProps) {
  if (!selectedItem) {
    return (
      <Card className="md:col-span-2 border-2 shadow-sm">
        <CardContent className="p-6">
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4 py-12">
            <Search className="h-12 w-12 opacity-20" />
            <p>Select a user from the results to view actions</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const canResendVerification = selectedItem.status === 'pending_verification';
  const canResendActivation = selectedItem.status === 'approved';
  const canSendReset = canResendActivation && Boolean(selectedItem.username);

  return (
    <Card className="md:col-span-2 border-2 shadow-sm">
      <CardContent className="p-6">
        <div className="space-y-6">
          <div className="border-b pb-4">
            <h3 className="text-xl font-bold text-foreground">{selectedItem.name}</h3>
            <div className="mt-1 flex flex-wrap gap-4 text-sm text-muted-foreground">
              <p>Email: <span className="font-medium text-foreground">{selectedItem.email}</span></p>
              {selectedItem.username && (
                <p>Username: <span className="font-medium text-foreground">{selectedItem.username}</span></p>
              )}
              <p>ID: <span className="font-mono text-xs">{selectedItem.id}</span></p>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="font-semibold text-foreground">Available Actions</h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className={`p-4 rounded-lg border-2 ${canResendVerification ? 'border-yellow-300 bg-yellow-50 dark:bg-yellow-950/40' : 'border-border bg-muted/50 opacity-50'}`}>
                <h5 className="font-bold text-foreground mb-1">Resend Verification Email</h5>
                <p className="text-sm text-muted-foreground mb-4">Send a new email confirmation link.</p>
                <Button
                  className="w-full"
                  variant={canResendVerification ? 'default' : 'outline'}
                  disabled={!canResendVerification || actionLoading}
                  onClick={() => initiateAction(
                    `/api/admin/requests/${selectedItem.id}/resend-verification`,
                    'Resend Verification?',
                    'Are you sure you want to resend the verification email to this user?'
                  )}
                >
                  Resend Verification
                </Button>
              </div>

              <div className={`p-4 rounded-lg border-2 ${canResendActivation ? 'border-purple-300 bg-purple-50 dark:bg-purple-950/40' : 'border-border bg-muted/50 opacity-50'}`}>
                <h5 className="font-bold text-foreground mb-1">Resend Activation Token</h5>
                <p className="text-sm text-muted-foreground mb-4">Send a new activation link (internal users).</p>
                <Button
                  className="w-full"
                  variant={canResendActivation ? 'default' : 'outline'}
                  disabled={!canResendActivation || actionLoading}
                  onClick={() => initiateAction(
                    `/api/admin/requests/${selectedItem.id}/resend-activation`,
                    'Resend Activation Token?',
                    'This will invalidate any previous activation tokens. Continue?'
                  )}
                >
                  Resend Activation
                </Button>
              </div>

              <div className={`p-4 rounded-lg border-2 ${canSendReset ? 'border-red-300 bg-red-50 dark:bg-red-950/40' : 'border-border bg-muted/50 opacity-50'}`}>
                <h5 className="font-bold text-foreground mb-1">Send Admin Reset Link</h5>
                <p className="text-sm text-muted-foreground mb-4">Email a one-time AD password reset link for active accounts.</p>
                <Button
                  className="w-full bg-red-600 hover:bg-red-700 text-white"
                  disabled={!canSendReset || actionLoading}
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
      </CardContent>
    </Card>
  );
}
