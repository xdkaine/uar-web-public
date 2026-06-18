'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"

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

interface UserDetailModalProps {
  user: LDAPUser | null;
  onClose: () => void;
}

export default function UserDetailModal({ user, onClose }: UserDetailModalProps) {
  // If user is null, the Dialog open prop will be false, so it won't show.
  // However, we need to handle the content rendering only when user exists.
  const formatVerificationSource = (source: string | null | undefined) => {
    switch (source) {
      case 'offboard_campaign':
        return 'Campaign';
      case 'registration_verified':
        return 'Registration verified';
      case 'registration':
        return 'Registration';
      default:
        return 'No record';
    }
  };
  
  return (
    <Dialog open={!!user} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
        </DialogHeader>

        {user && (
          <div className="space-y-6">
            <div>
              <h4 className="text-lg font-semibold text-foreground mb-3">Basic Information</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Username</Label>
                  <p className="font-medium">{user.username}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Display Name</Label>
                  <p>{user.displayName || '—'}</p>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-muted-foreground">Email</Label>
                  <p>{user.email || '—'}</p>
                </div>
                <div className="col-span-2 space-y-1">
                  <Label className="text-muted-foreground">Description</Label>
                  <p>{user.description || '—'}</p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-lg font-semibold text-foreground mb-3">Account Status</h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge variant={user.accountEnabled ? "default" : "destructive"}>
                      {user.accountEnabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Account Expires</Label>
                  <p>
                    {user.accountExpires ? (
                      new Date(user.accountExpires).toLocaleString()
                    ) : (
                      'Never'
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Created</Label>
                  <p>
                    {user.whenCreated ? (
                      new Date(user.whenCreated).toLocaleString()
                    ) : (
                      '—'
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Last Verified</Label>
                  <p>
                    {user.lastVerifiedAt ? (
                      <>
                        {new Date(user.lastVerifiedAt).toLocaleString()}
                        <span className="block text-xs text-muted-foreground">{formatVerificationSource(user.lastVerifiedSource)}</span>
                      </>
                    ) : (
                      'N/A'
                    )}
                  </p>
                </div>
                <div className="space-y-1">
                  <Label className="text-muted-foreground">Original Registration</Label>
                  <p>
                    {user.originalRegistrationAt ? (
                      new Date(user.originalRegistrationAt).toLocaleString()
                    ) : (
                      'N/A'
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-lg font-semibold text-foreground mb-3">
                Group Memberships ({(user.memberOf || []).length})
              </h4>
              {(user.memberOf || []).length > 0 ? (
                <div className="bg-muted/50 rounded-lg p-4 max-h-60 overflow-y-auto border">
                  <ul className="space-y-2">
                    {(user.memberOf || []).map((group, index) => {
                      const groupName = group.split(',')[0].replace('CN=', '');
                      return (
                        <li key={index} className="flex items-start gap-2">
                          <span className="text-primary mt-0.5">•</span>
                          <div className="flex-1">
                            <p className="font-medium">{groupName}</p>
                            <p className="text-xs text-muted-foreground break-all">{group}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : (
                <p className="text-muted-foreground italic">No group memberships</p>
              )}
            </div>

            <div>
              <h4 className="text-lg font-semibold text-foreground mb-3">Technical Details</h4>
              <div className="space-y-1">
                <Label className="text-muted-foreground">Distinguished Name (DN)</Label>
                <p className="text-xs font-mono bg-muted p-2 rounded break-all border">
                  {user.dn}
                </p>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
