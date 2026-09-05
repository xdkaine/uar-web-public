import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ChangeEvent } from 'react';

interface RequestDecisionDialogsProps {
  showRejectModal: boolean;
  rejectionReason: string;
  showApproveModal: boolean;
  approvalMessage: string;
  onRejectOpenChange: (open: boolean) => void;
  onRejectionReasonChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onCancelReject: () => void;
  onSubmitRejection: () => void;
  onApproveOpenChange: (open: boolean) => void;
  onApprovalMessageChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onCancelApprove: () => void;
  onSubmitApproval: () => void;
}

export default function RequestDecisionDialogs({
  showRejectModal,
  rejectionReason,
  showApproveModal,
  approvalMessage,
  onRejectOpenChange,
  onRejectionReasonChange,
  onCancelReject,
  onSubmitRejection,
  onApproveOpenChange,
  onApprovalMessageChange,
  onCancelApprove,
  onSubmitApproval,
}: RequestDecisionDialogsProps) {
  return (
    <>
      <Dialog open={showRejectModal} onOpenChange={onRejectOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reject Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="rejection-reason" className="block text-sm font-medium text-muted-foreground mb-2">
                Rejection Reason
              </label>
              <textarea
                id="rejection-reason"
                value={rejectionReason}
                onChange={onRejectionReasonChange}
                rows={4}
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Provide a detailed reason for rejecting this request..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={onCancelReject} className="px-4 py-2 text-muted-foreground bg-muted rounded-lg hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={onSubmitRejection} className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">
                Reject Request
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showApproveModal} onOpenChange={onApproveOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Request</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Confirm that the account has been created. You can optionally add a follow-up message that will be included in the email to the user.
            </p>
            <div>
              <label htmlFor="approval-message" className="block text-sm font-medium text-muted-foreground mb-2">
                Follow-up Message (Optional)
              </label>
              <textarea
                id="approval-message"
                value={approvalMessage}
                onChange={onApprovalMessageChange}
                rows={4}
                className="w-full px-3 py-2 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Add any additional information, instructions, or notes for the user..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button onClick={onCancelApprove} className="px-4 py-2 text-muted-foreground bg-muted rounded-lg hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={onSubmitApproval} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                Approve Request
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
