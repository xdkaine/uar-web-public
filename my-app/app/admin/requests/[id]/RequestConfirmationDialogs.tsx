import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface RequestConfirmationConfig {
  title: string;
  message: string;
  onConfirm: () => void;
  type?: 'standard' | 'username-mismatch';
}

interface RequestConfirmationDialogsProps {
  showConfirmModal: boolean;
  confirmModalConfig: RequestConfirmationConfig | null;
  onStandardOpenChange: (open: boolean) => void;
  onCancelStandard: () => void;
  onConfirmStandard: () => void;
  onUsernameMismatchOpenChange: (open: boolean) => void;
  onCancelUsernameMismatch: () => void;
  onConfirmUsernameMismatch: () => void;
}

export default function RequestConfirmationDialogs({
  showConfirmModal,
  confirmModalConfig,
  onStandardOpenChange,
  onCancelStandard,
  onConfirmStandard,
  onUsernameMismatchOpenChange,
  onCancelUsernameMismatch,
  onConfirmUsernameMismatch,
}: RequestConfirmationDialogsProps) {
  return (
    <>
      {(!confirmModalConfig?.type || confirmModalConfig.type === 'standard') && (
        <Dialog open={showConfirmModal} onOpenChange={onStandardOpenChange}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{confirmModalConfig?.title || 'Confirm'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <p className="text-muted-foreground">{confirmModalConfig?.message}</p>
              <div className="flex justify-end gap-3">
                <button onClick={onCancelStandard} className="px-4 py-2 text-muted-foreground bg-muted rounded-lg hover:bg-muted transition-colors">
                  Cancel
                </button>
                <button onClick={onConfirmStandard} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
                  Confirm
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {confirmModalConfig?.type === 'username-mismatch' && (
        <Dialog open={showConfirmModal} onOpenChange={onUsernameMismatchOpenChange}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{confirmModalConfig.title}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="p-4 bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-900 rounded-lg">
                <div className="flex items-start gap-2">
                  <svg className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <div className="text-sm text-yellow-900 dark:text-yellow-200 whitespace-pre-line">
                    {confirmModalConfig.message}
                  </div>
                </div>
              </div>
              <div className="flex justify-end gap-3">
                <button onClick={onCancelUsernameMismatch} className="px-4 py-2 text-muted-foreground bg-muted rounded-lg hover:bg-muted transition-colors">
                  Cancel
                </button>
                <button onClick={onConfirmUsernameMismatch} className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors font-semibold">
                  Force Assignment
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
