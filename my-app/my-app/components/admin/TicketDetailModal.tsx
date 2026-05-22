'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

interface TicketResponse {
  id: string;
  message: string;
  author: string;
  isStaff: boolean;
  createdAt: string;
}

interface TicketStatusLog {
  id: string;
  createdAt: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string;
  isStaff: boolean;
}

interface SupportTicket {
  id: string;
  subject: string;
  category: string | null;
  severity: string | null;
  body: string;
  status: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  responses: TicketResponse[];
  statusLogs: TicketStatusLog[];
}

interface TicketDetailModalProps {
  ticket: SupportTicket | null;
  onClose: () => void;
  onAddResponse: (ticketId: string, message: string) => Promise<void>;
  onUpdateStatus: (ticketId: string, status: string) => Promise<void>;
  isSubmitting: boolean;
  isUpdatingStatus: boolean;
}

export default function TicketDetailModal({ 
  ticket, 
  onClose, 
  onAddResponse, 
  onUpdateStatus,
  isSubmitting,
  isUpdatingStatus 
}: TicketDetailModalProps) {
  const [responseMessage, setResponseMessage] = useState('');

  if (!ticket) return null;

  const getSeverityBadgeVariant = (severity: string | null) => {
    switch (severity) {
      case 'critical': return 'destructive';
      case 'high': return 'destructive'; // Or a custom orange variant if available, defaulting to destructive/default
      case 'medium': return 'secondary'; // yellow often mapped to warning, or secondary
      case 'low': return 'outline';
      default: return 'outline';
    }
  };
  // Helper for custom colors since Badge variants are limited by default
  const getSeverityClass = (severity: string | null) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100';
      case 'high': return 'bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100';
      case 'medium': return 'bg-yellow-100 text-yellow-800 border-yellow-200 hover:bg-yellow-100';
      case 'low': return 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100';
      default: return 'bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-100';
    }
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'open': return 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100';
      case 'in_progress': return 'bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100';
      case 'closed': return 'bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-100';
      default: return 'bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-100';
    }
  };

  const formatStatus = (status: string) => {
    return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  };

  const handleSubmit = async () => {
    if (!responseMessage.trim()) return;
    await onAddResponse(ticket.id, responseMessage);
    setResponseMessage('');
  };

  return (
    <Dialog open={!!ticket} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col p-0 gap-0">
        <DialogHeader className="p-6 pb-2 border-b">
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1 space-y-3">
              <div className="flex gap-2 flex-wrap">
                <Badge variant="outline" className={getStatusClass(ticket.status)}>
                  {formatStatus(ticket.status)}
                </Badge>
                {ticket.category && (
                  <Badge variant="outline" className="bg-indigo-100 text-indigo-800 border-indigo-200 hover:bg-indigo-100">
                    {ticket.category}
                  </Badge>
                )}
                {ticket.severity && (
                  <Badge variant="outline" className={getSeverityClass(ticket.severity)}>
                    {ticket.severity.toUpperCase()}
                  </Badge>
                )}
              </div>
              <DialogTitle className="text-2xl font-bold text-gray-900">{ticket.subject}</DialogTitle>
              <p className="text-sm text-gray-600">
                <span className="font-medium">From:</span> {ticket.username} • <span className="font-medium">Ticket #</span><span className="font-mono">{ticket.id.slice(0, 8)}</span>
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-6 flex-1 overflow-y-auto">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Original Message</h3>
            <div className="bg-gray-50 p-5 rounded-lg border border-gray-200">
              <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">
                {ticket.body}
              </p>
              <p className="text-sm text-gray-500 mt-4 pt-4 border-t border-gray-300">
                <span className="font-medium">Created:</span> {new Date(ticket.createdAt).toLocaleString()}
              </p>
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Ticket Actions</h3>
            <div className="flex gap-3 flex-wrap">
              {ticket.status !== 'in_progress' && (
                <Button
                  onClick={() => onUpdateStatus(ticket.id, 'in_progress')}
                  disabled={isUpdatingStatus}
                  className="bg-purple-600 text-white hover:bg-purple-700 font-semibold"
                >
                  Mark In Progress
                </Button>
              )}
              {ticket.status !== 'closed' && (
                <Button
                  onClick={() => onUpdateStatus(ticket.id, 'closed')}
                  disabled={isUpdatingStatus}
                  className="bg-gray-700 text-white hover:bg-gray-800 font-semibold"
                >
                  Close Ticket
                </Button>
              )}
              {ticket.status === 'closed' && (
                <Button
                  onClick={() => onUpdateStatus(ticket.id, 'open')}
                  disabled={isUpdatingStatus}
                  className="bg-blue-600 text-white hover:bg-blue-700 font-semibold"
                >
                  Reopen Ticket
                </Button>
              )}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Status History ({ticket.statusLogs?.length || 0})
            </h3>
            {!ticket.statusLogs || ticket.statusLogs.length === 0 ? (
              <p className="text-gray-600 text-center py-6 bg-gray-50 rounded-lg border border-gray-200">No status changes yet</p>
            ) : (
              <div className="space-y-3">
                {ticket.statusLogs.map((log) => (
                  <div key={log.id} className="bg-blue-50 border-l-4 border-l-blue-500 pl-5 py-4 rounded-r border border-blue-200">
                    <div className="flex justify-between items-start mb-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{log.changedBy}</span>
                        {log.isStaff && (
                          <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-200">
                            Staff
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm text-gray-600 font-medium">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-gray-800">
                      {log.oldStatus ? (
                        <>
                          Changed status from <span className="font-bold">{formatStatus(log.oldStatus)}</span> to <span className="font-bold">{formatStatus(log.newStatus)}</span>
                        </>
                      ) : (
                        <>
                          Created ticket with status <span className="font-bold">{formatStatus(log.newStatus)}</span>
                        </>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Responses ({ticket.responses.length})
            </h3>
            {ticket.responses.length === 0 ? (
              <p className="text-gray-600 text-center py-6 bg-gray-50 rounded-lg border border-gray-200">No responses yet</p>
            ) : (
              <div className="space-y-4">
                {ticket.responses.map((response) => (
                  <div key={response.id} className="bg-gray-50 border-l-4 border-l-gray-400 pl-5 py-4 rounded-r border border-gray-200">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{response.author}</span>
                        {response.isStaff && (
                          <Badge variant="secondary" className="bg-green-100 text-green-800 border-green-200">
                            Staff
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm text-gray-600 font-medium">
                        {new Date(response.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">{response.message}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          {ticket.status !== 'closed' && (
            <div className="border-t-2 border-gray-200 pt-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Response</h3>
              <div className="bg-gray-50 p-5 rounded-lg border border-gray-200">
                <Textarea
                  value={responseMessage}
                  onChange={(e) => setResponseMessage(e.target.value)}
                  rows={5}
                  className="w-full bg-white mb-4"
                  placeholder="Type your response here..."
                />
                <div className="flex justify-end gap-3">
                  <Button
                    onClick={() => setResponseMessage('')}
                    variant="outline"
                  >
                    Clear
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={isSubmitting || !responseMessage.trim()}
                    className="bg-black text-white hover:bg-gray-800"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit Response'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-4 flex justify-end">
          <Button
            onClick={onClose}
            className="bg-black hover:bg-gray-800 text-white"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
