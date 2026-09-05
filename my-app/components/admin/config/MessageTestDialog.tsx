'use client';

import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { MessageTemplate } from './message-panel-types';

export function MessageTestDialog({ open, template, saving, recipientMode, recipient, onOpenChange, onRecipientMode, onRecipient, onSend }: {
  open: boolean; template: MessageTemplate | null; saving: boolean; recipientMode: 'self' | 'specific'; recipient: string;
  onOpenChange: (open: boolean) => void; onRecipientMode: (mode: 'self' | 'specific') => void; onRecipient: (recipient: string) => void; onSend: () => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent><DialogHeader><DialogTitle>Send test email</DialogTitle><DialogDescription>Sends the current saved draft, or the published version when no draft exists, using sample placeholder values.</DialogDescription></DialogHeader><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Recipient</legend><RecipientOption mode="self" currentMode={recipientMode} onChange={onRecipientMode} title="My directory email" description="Use the verified email on your administrator account." /><RecipientOption mode="specific" currentMode={recipientMode} onChange={onRecipientMode} title="Specific email address" description="Send this one test to an address you choose." /></fieldset>{recipientMode === 'specific' && <div className="space-y-1.5"><Label htmlFor="message-test-recipient">Email address</Label><Input id="message-test-recipient" type="email" autoComplete="email" value={recipient} onChange={(event) => onRecipient(event.target.value)} placeholder="reviewer@example.edu" /></div>}<DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="button" disabled={!template || saving || (recipientMode === 'specific' && !recipient.trim())} onClick={onSend}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send test</Button></DialogFooter></DialogContent></Dialog>;
}

function RecipientOption({ mode, currentMode, onChange, title, description }: { mode: 'self' | 'specific'; currentMode: 'self' | 'specific'; onChange: (mode: 'self' | 'specific') => void; title: string; description: string }) {
  return <label className={cn('flex cursor-pointer gap-3 rounded-md border p-3', currentMode === mode && 'border-primary bg-primary/5')}><input type="radio" name="test-recipient" value={mode} checked={currentMode === mode} onChange={() => onChange(mode)} className="mt-1" /><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{description}</span></span></label>;
}
