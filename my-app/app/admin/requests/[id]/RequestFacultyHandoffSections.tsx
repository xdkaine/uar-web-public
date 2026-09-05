import type { AccessRequest } from './RequestDetailTypes';

interface FacultyAccountDetailsProps {
  request: AccessRequest;
  canRevealPassword: boolean;
  showFacultyPassword: boolean;
  revealedFacultyPassword: string;
  revealPasswordLoading: boolean;
  onToggleFacultyPassword: () => void;
  onRevealFacultyPassword: () => void;
}

export function FacultyAccountDetails({
  request,
  canRevealPassword,
  showFacultyPassword,
  revealedFacultyPassword,
  revealPasswordLoading,
  onToggleFacultyPassword,
  onRevealFacultyPassword,
}: FacultyAccountDetailsProps) {
  return (
    <div className="bg-blue-50 dark:bg-blue-950/40 p-4 rounded-lg border-2 border-blue-200 dark:border-blue-900 mb-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">
        Account Details
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground font-medium">
            AD Username:
          </span>
          <span className="ml-2 text-foreground font-semibold">
            {request.ldapUsername}
          </span>
        </div>
        {!request.isInternal && (
          <div>
            <span className="text-muted-foreground font-medium">
              VPN Username:
            </span>
            <span className="ml-2 text-foreground font-semibold">
              {request.vpnUsername}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-medium">Password:</span>
          <span className="ml-2 text-foreground font-mono font-semibold">
            {request.isInternal
              ? 'N/A'
              : showFacultyPassword && revealedFacultyPassword
                ? revealedFacultyPassword
                : request.hasPassword
                  ? '••••••••'
                  : 'Not stored'}
          </span>
          {canRevealPassword &&
            (revealedFacultyPassword ? (
              <button
                type="button"
                onClick={onToggleFacultyPassword}
                className="text-xs font-medium text-primary hover:underline"
              >
                {showFacultyPassword ? 'Hide' : 'Show'}
              </button>
            ) : (
              <button
                type="button"
                onClick={onRevealFacultyPassword}
                disabled={revealPasswordLoading}
                className="rounded border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                {revealPasswordLoading ? 'Revealing…' : 'Reveal (audited)'}
              </button>
            ))}
        </div>
        {request.accountExpiresAt && (
          <div>
            <span className="text-muted-foreground font-medium">
              Account Disables:
            </span>
            <span className="ml-2 text-foreground font-semibold">
              {new Date(request.accountExpiresAt).toLocaleString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

interface FacultyMessageProps {
  request: AccessRequest;
  showFacultyMessage: boolean;
  revealedFacultyPassword: string;
  onCopyFacultyMessage: () => void;
  onToggleFacultyMessage: () => void;
  generateFacultyMessage: () => string;
}

export function FacultyMessage({
  request,
  showFacultyMessage,
  revealedFacultyPassword,
  onCopyFacultyMessage,
  onToggleFacultyMessage,
  generateFacultyMessage,
}: FacultyMessageProps) {
  return (
    <div className="bg-muted/50 p-4 rounded-lg border-2 border-border mb-4">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold text-foreground">
          Message to Faculty
        </h3>
        <div className="flex gap-2">
          <button
            onClick={onCopyFacultyMessage}
            disabled={!request.isInternal && !revealedFacultyPassword}
            className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Copy message
          </button>
          <button
            onClick={onToggleFacultyMessage}
            className="px-3 py-1.5 bg-primary text-primary-foreground hover:bg-primary/90 rounded text-xs font-semibold flex items-center gap-1"
          >
            {showFacultyMessage ? (
              <>
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 15l7-7 7 7"
                  />
                </svg>
                Hide
              </>
            ) : (
              <>
                <svg
                  className="w-3 h-3"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 9l-7 7-7-7"
                  />
                </svg>
                Show
              </>
            )}
          </button>
        </div>
      </div>
      {showFacultyMessage && (
        <pre className="text-xs sm:text-sm text-foreground whitespace-pre-wrap font-sans bg-card p-3 rounded border border-border mt-2">
          {generateFacultyMessage()}
        </pre>
      )}
    </div>
  );
}

interface FacultyNotificationProps {
  request: AccessRequest;
  actionLoading: boolean;
  onUndoNotifyFaculty: () => void;
  onNotifyFaculty: () => void;
}

export function FacultyNotification({
  request,
  actionLoading,
  onUndoNotifyFaculty,
  onNotifyFaculty,
}: FacultyNotificationProps) {
  return (
    <div className="mb-4">
      {request.sentToFacultyAt ? (
        <div>
          <div className="bg-green-50 dark:bg-green-950/40 p-3 rounded-lg border border-green-200 dark:border-green-900 flex items-center gap-2 mb-2">
            <svg
              className="w-5 h-5 text-green-600 dark:text-green-400"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                clipRule="evenodd"
              />
            </svg>
            <div className="text-sm flex-1">
              <span className="text-green-800 dark:text-green-200 font-semibold">
                Sent to Faculty
              </span>
              <span className="text-green-700 dark:text-green-200 ml-2">
                on {new Date(request.sentToFacultyAt).toLocaleString()} by{' '}
                {request.sentToFacultyBy}
              </span>
            </div>
          </div>
          <button
            onClick={onUndoNotifyFaculty}
            disabled={actionLoading}
            className="w-full bg-muted-foreground hover:bg-muted-foreground/80 text-white font-bold px-4 py-2 rounded-lg transition-colors disabled:opacity-50 text-sm"
          >
            {actionLoading
              ? 'Processing...'
              : 'Undo \"Sent to Faculty\" Status'}
          </button>
        </div>
      ) : (
        <button
          onClick={onNotifyFaculty}
          disabled={actionLoading}
          className="w-full bg-yellow-500 hover:bg-yellow-600 text-white font-bold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 text-sm"
        >
          {actionLoading ? 'Processing...' : 'Mark as Sent to Faculty'}
        </button>
      )}
    </div>
  );
}

interface FacultyDecisionActionsProps {
  actionLoading: boolean;
  onApprove: () => void;
  onReject: () => void;
  onMoveBack: () => void;
}

export function FacultyDecisionActions({
  actionLoading,
  onApprove,
  onReject,
  onMoveBack,
}: FacultyDecisionActionsProps) {
  return (
    <>
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-2 sm:pt-4 border-t border-border">
        <button
          onClick={onApprove}
          disabled={actionLoading}
          className="w-full sm:w-auto bg-green-600 hover:bg-green-500 text-white font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-[background-color,box-shadow] disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          {actionLoading
            ? 'Processing...'
            : 'Confirm Account Created & Approve'}
        </button>
        <button
          onClick={onReject}
          disabled={actionLoading}
          className="w-full sm:w-auto bg-card border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 hover:border-red-300 font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-[background-color,border-color,box-shadow] disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
          {actionLoading ? 'Processing...' : 'Reject Request'}
        </button>
      </div>
      <div className="mt-4 pt-4 border-t border-border">
        <button
          onClick={onMoveBack}
          disabled={actionLoading}
          className="w-full bg-muted-foreground hover:bg-muted-foreground text-white font-bold px-4 py-2.5 rounded-lg transition-colors disabled:opacity-50 text-sm flex items-center justify-center gap-2"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7 7-7"
            />
          </svg>
          {actionLoading ? 'Processing...' : 'Move Back to Student Directors'}
        </button>
        <p className="text-xs text-muted-foreground mt-2 text-center">
          Use this to send the request back to Student Directors if credentials
          need to be changed
        </p>
      </div>
    </>
  );
}
