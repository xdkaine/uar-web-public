'use client';

import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ClientLocalDate } from './ClientLocalDate';
import { TicketDetailHeader } from './TicketDetailHeader';
import { TicketDetailConversation } from './TicketDetailConversation';
import { TicketDetailSidebar } from './TicketDetailSidebar';
import { isEmptyRichText } from '@/lib/ticket-content';
import type { SupportTicket } from './TicketDetailTypes';

export { TicketAccessSection as TicketAssignmentSection } from './TicketAccessSection';

interface TicketDetailModalProps {
  ticket: SupportTicket | null;
  onClose: () => void;
  onAddResponse: (ticketId: string, message: string) => Promise<void>;
  onUpdateStatus: (ticketId: string, status: string) => Promise<void>;
  isSubmitting: boolean;
  isUpdatingStatus: boolean;
  onUploadFiles?: (ticketId: string, files: File[]) => Promise<boolean>;
}
export default function TicketDetailModal({ ticket, onClose, onAddResponse, onUpdateStatus, isSubmitting, isUpdatingStatus, onUploadFiles }: TicketDetailModalProps) {
  const [responseMessage, setResponseMessage] = useState('');
  const [uploadingFiles, setUploadingFiles] = useState(false);

  if (!ticket) return null;

  const handleSubmit = async () => {
    if (isEmptyRichText(responseMessage)) return;
    await onAddResponse(ticket.id, responseMessage);
    setResponseMessage('');
  };
  const handleUploadFiles = async (files: File[]) => {
    if (files.length === 0 || !onUploadFiles) return;
    setUploadingFiles(true);
    try {
      await onUploadFiles(ticket.id, files);
    } finally {
      setUploadingFiles(false);
    }
  };

  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent size="wide" className="overflow-hidden flex flex-col p-0 gap-0"><TicketDetailHeader ticket={ticket} isUpdating={isUpdatingStatus} onStatus={(status) => void onUpdateStatus(ticket.id, status)} /><div className="grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_360px] lg:overflow-hidden"><TicketDetailConversation ticket={ticket} value={responseMessage} onChange={setResponseMessage} onSubmit={() => void handleSubmit()} onClear={() => setResponseMessage('')} isSubmitting={isSubmitting} uploadingFiles={uploadingFiles} onImageFiles={onUploadFiles ? (files) => void handleUploadFiles(files) : undefined} /><TicketDetailSidebar ticket={ticket} /></div><div className="flex flex-col gap-2 border-t border-border bg-muted/50 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="min-w-0 text-xs text-muted-foreground">Last updated <ClientLocalDate value={ticket.updatedAt} />{ticket.closedAt && ticket.closedBy ? ` · Closed by ${ticket.closedBy}` : ''}</p><Button onClick={onClose} variant="outline" size="sm">Close</Button></div></DialogContent></Dialog>;
}
