import type { AccessRequest } from "./RequestDetailTypes";

export default function RequestGrandfatheredNotice({
  request,
}: {
  request: AccessRequest;
}) {
  if (!request.isGrandfatheredAccount || request.isManuallyAssigned)
    return null;

  return (
    <div className="mb-4 sm:mb-6 p-4 bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-400 dark:border-amber-900 rounded-lg">
      <div className="flex items-start gap-3">
        <svg
          className="w-6 h-6 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <div className="flex-1">
          <h2 className="text-lg font-bold text-amber-900 dark:text-amber-200 mb-2">
            ⚠️ Grandfathered Account Detected
          </h2>
          <p className="text-amber-800 dark:text-amber-200 mb-2">
            An Active Directory account already exists for this user but has no
            email address associated with it.
          </p>
          <div className="bg-amber-100 dark:bg-amber-950/60 p-3 rounded border border-amber-300 dark:border-amber-900 mb-3">
            <p className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
              Detected Username:
            </p>
            <p className="font-mono text-lg text-amber-900 dark:text-amber-200">
              {request.ldapUsername || "Unknown"}
            </p>
          </div>
          <div className="bg-card p-3 rounded border border-amber-300 dark:border-amber-900">
            <p className="font-semibold text-amber-900 dark:text-amber-200 mb-2">
              ⚠️ Important - Do NOT create a new account!
            </p>
            <ul className="list-disc list-inside text-amber-800 dark:text-amber-200 text-sm space-y-1">
              <li>This user already has an Active Directory account</li>
              <li>
                Use &quot;Link to Existing Account&quot; option below instead
              </li>
              <li>Creating a new account will cause conflicts</li>
              <li>The username field below is pre-filled for linking</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
