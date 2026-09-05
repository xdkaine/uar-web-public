import type { AccessRequest } from './RequestDetailTypes';

export default function RequestRejectedDetails({ request }: { request: AccessRequest }) {
  if (request.status !== 'rejected') return null;
  return (
    <section className="border-t border-border pt-4 sm:pt-6">
      <h2 className="text-lg sm:text-xl font-semibold mb-3 sm:mb-4 text-red-900 dark:text-red-300 flex items-center gap-2">
        <svg className="w-6 h-6 text-red-600 dark:text-red-400" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
        Rejection Information
      </h2>
      <div className="bg-red-50 dark:bg-red-950/40 border-2 border-red-300 dark:border-red-900 rounded-lg p-4 sm:p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {request.rejectedBy && (
            <div>
              <p className="text-red-800 dark:text-red-200 text-xs sm:text-sm font-medium">Rejected By</p>
              <p className="text-sm sm:text-base text-red-900 dark:text-red-300 font-semibold wrap-break-word">{request.rejectedBy}</p>
            </div>
          )}
          {request.rejectedAt && (
            <div>
              <p className="text-red-800 dark:text-red-200 text-xs sm:text-sm font-medium">Rejected At</p>
              <p className="text-sm sm:text-base text-red-900 dark:text-red-300 font-semibold">
                {new Date(request.rejectedAt).toLocaleString()}
              </p>
            </div>
          )}
        </div>
        {request.rejectionReason && (
          <div>
            <p className="text-red-800 dark:text-red-200 text-xs sm:text-sm font-medium block mb-2">Rejection Reason</p>
            <div className="bg-card border border-red-300 dark:border-red-900 rounded-lg p-3 sm:p-4">
              <p className="text-sm sm:text-base text-red-900 dark:text-red-300 whitespace-pre-wrap wrap-break-word">
                {request.rejectionReason}
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
