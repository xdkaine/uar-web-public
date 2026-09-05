import DateTimePicker from '@/components/DateTimePicker';
import type { AccessRequest } from './RequestDetailTypes';

interface RequestSetupProps {
  request: AccessRequest;
}

export function RequestSetupAlerts({ request }: RequestSetupProps) {
  return (
    <>
      {request.ldapUsername && (
        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg flex items-start gap-2">
          <svg
            className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-sm text-blue-800 dark:text-blue-200">
            <strong>Note:</strong> This request was previously moved to Faculty
            stage. The existing credentials have been loaded and can be edited
            if needed.
          </p>
        </div>
      )}
      <p className="text-muted-foreground text-sm sm:text-base mb-4">
        Set the directory account username
        {!request.isInternal && ', VPN username'}, and password. These
        credentials are carried into the next configured review stage.
      </p>
      {!request.isInternal && (
        <div className="mb-4 p-3 bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-900 rounded-lg flex items-start gap-2">
          <svg
            className="w-5 h-5 text-yellow-600 dark:text-yellow-400 shrink-0 mt-0.5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            <strong>Important:</strong> The account will be automatically
            disabled by Active Directory at the specified disable date/time.
            Make sure to set the appropriate date and time for account
            expiration.
          </p>
        </div>
      )}
    </>
  );
}

interface AccountIdentityFieldsProps extends RequestSetupProps {
  ldapUsername: string;
  vpnUsername: string;
  usernameCheckMessage: string;
  vpnModuleEnabled: boolean;
  onLdapUsernameChange: (value: string) => void;
  onVpnUsernameChange: (value: string) => void;
  onCheckUsernameAvailability: () => void;
}

export function AccountIdentityFields({
  request,
  ldapUsername,
  vpnUsername,
  usernameCheckMessage,
  vpnModuleEnabled,
  onLdapUsernameChange,
  onVpnUsernameChange,
  onCheckUsernameAvailability,
}: AccountIdentityFieldsProps) {
  return (
    <>
      <div>
        <label
          htmlFor="directory-username"
          className="block text-xs sm:text-sm font-medium mb-2 text-foreground"
        >
          Directory username *
        </label>
        <div className="flex gap-2">
          <input
            id="directory-username"
            type="text"
            value={ldapUsername}
            onChange={(e) => onLdapUsernameChange(e.target.value)}
            className="flex-1 px-3 sm:px-4 py-2 bg-card border-2 border-border rounded-lg text-foreground focus:ring-2 focus:ring-ring focus:border-transparent text-sm sm:text-base"
            placeholder="username"
          />
          {!request.accountCreatedAt && (
            <button
              onClick={onCheckUsernameAvailability}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-sm font-semibold"
            >
              Check
            </button>
          )}
        </div>
        {!request.accountCreatedAt && usernameCheckMessage && (
          <p
            className={`text-xs sm:text-sm mt-1 ${usernameCheckMessage?.includes('available') ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}
          >
            {usernameCheckMessage}
          </p>
        )}
        {request.accountCreatedAt && (
          <p className="text-xs sm:text-sm mt-1 text-blue-600 dark:text-blue-400">
            Account already exists in Active Directory. Username changes will be
            applied when you update the account.
          </p>
        )}
      </div>
      {!request.isInternal && vpnModuleEnabled && (
        <div>
          <label
            htmlFor="vpn-username"
            className="block text-xs sm:text-sm font-medium mb-2 text-foreground"
          >
            VPN Username *
          </label>
          <input
            id="vpn-username"
            type="text"
            value={vpnUsername}
            onChange={(e) => onVpnUsernameChange(e.target.value)}
            className="w-full px-3 sm:px-4 py-2 bg-card border-2 border-border rounded-lg text-foreground focus:ring-2 focus:ring-ring focus:border-transparent text-sm sm:text-base"
            placeholder="username"
          />
        </div>
      )}
    </>
  );
}

interface AccountPasswordFieldsProps {
  password: string;
  showPassword: boolean;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onGeneratePassword: () => void;
}

export function AccountPasswordFields({
  password,
  showPassword,
  onPasswordChange,
  onTogglePassword,
  onGeneratePassword,
}: AccountPasswordFieldsProps) {
  return (
    <div className="bg-muted/50 p-4 rounded-lg border-2 border-border">
      <label
        htmlFor="directory-password"
        className="block text-xs sm:text-sm font-medium mb-2 text-foreground"
      >
        Password *
      </label>
      <div className="mb-3 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-300 dark:border-blue-900 rounded-lg">
        <div className="flex items-start gap-2">
          <svg
            className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5"
            fill="currentColor"
            viewBox="0 0 20 20"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>
          <div className="text-xs text-blue-900 dark:text-blue-200">
            <p className="font-semibold mb-1">
              Windows Default GPO Password Policy:
            </p>
            <ul className="list-disc ml-4 space-y-0.5">
              <li>Minimum length: 7 characters</li>
              <li>Must contain characters from 3 of 4 categories:</li>
              <ul className="list-circle ml-4 mt-0.5">
                <li>Uppercase letters (A-Z)</li>
                <li>Lowercase letters (a-z)</li>
                <li>Numbers (0-9)</li>
                <li>Special characters (!@#$%^&* etc.)</li>
              </ul>
              <li>Cannot contain username or parts of full name</li>
            </ul>
          </div>
        </div>
      </div>
      <div className="mb-3 relative">
        <input
          id="directory-password"
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          className="w-full px-3 sm:px-4 py-2 pr-10 bg-card border-2 border-border rounded-lg text-foreground focus:ring-2 focus:ring-ring focus:border-transparent text-sm sm:text-base font-mono"
          placeholder="Enter password or generate one below"
        />
        <button
          type="button"
          onClick={onTogglePassword}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
          aria-label={showPassword ? 'Hide password' : 'Show password'}
        >
          {showPassword ? (
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
              />
            </svg>
          )}
        </button>
      </div>
      <div className="space-y-3 border-t border-border pt-3">
        <button
          onClick={onGeneratePassword}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white font-bold px-4 py-2 rounded-lg transition-colors text-sm"
        >
          Generate Password
        </button>
      </div>
    </div>
  );
}

interface AccountExpirationProps extends RequestSetupProps {
  expirationDateTime: string;
  minExpirationDate: Date | undefined;
  onExpirationDateTimeChange: (value: string) => void;
}

export function AccountExpiration({
  request,
  expirationDateTime,
  minExpirationDate,
  onExpirationDateTimeChange,
}: AccountExpirationProps) {
  if (request.isInternal) return null;
  return (
    <>
      <DateTimePicker
        label="Account Disable Date & Time (Expiration)"
        value={expirationDateTime}
        onChange={onExpirationDateTimeChange}
        required
        placeholder="Select date and time"
        minDate={minExpirationDate}
        className="w-full"
      />
      <p className="text-muted-foreground text-xs sm:text-sm mt-2">
        Select the date and time when the account will be automatically
        disabled. External accounts require an expiration date and time.
      </p>
    </>
  );
}

export function ExistingAccountNotice({ request }: RequestSetupProps) {
  if (!request.accountCreatedAt) return null;
  return (
    <div className="p-4 bg-green-50 dark:bg-green-950/40 border-2 border-green-200 dark:border-green-900 rounded-lg">
      <div className="flex items-start gap-3">
        <svg
          className="w-6 h-6 text-green-600 dark:text-green-400 shrink-0 mt-0.5"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
            clipRule="evenodd"
          />
        </svg>
        <div>
          <h4 className="font-semibold text-green-900 dark:text-green-200 mb-1">
            Directory account previously created
          </h4>
          <p className="text-sm text-green-800 dark:text-green-200">
            Account was created in Active Directory on{' '}
            {new Date(request.accountCreatedAt).toLocaleString()}
          </p>
          <p className="text-sm text-green-800 dark:text-green-200 mt-1">
            You can update credentials and re-apply them to the directory
            account, or move this request to the next review stage.
          </p>
        </div>
      </div>
    </div>
  );
}

interface AccountActionsProps extends RequestSetupProps {
  actionLoading: boolean;
  usernameCheckMessage: string;
  supportsFacultyHandoff: boolean;
  onCreateAccount: () => void;
  onManualAssign: () => void;
  onUpdateAccount: () => void;
  onReturnToFaculty: () => void;
  onReject: () => void;
}

export function AccountActions({
  request,
  actionLoading,
  usernameCheckMessage,
  supportsFacultyHandoff,
  onCreateAccount,
  onManualAssign,
  onUpdateAccount,
  onReturnToFaculty,
  onReject,
}: AccountActionsProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 pt-2 sm:pt-4 border-t border-border">
      {!request.accountCreatedAt ? (
        <CreateAccountActions
          request={request}
          actionLoading={actionLoading}
          usernameCheckMessage={usernameCheckMessage}
          onCreateAccount={onCreateAccount}
          onManualAssign={onManualAssign}
        />
      ) : (
        <UpdateAccountActions
          actionLoading={actionLoading}
          supportsFacultyHandoff={supportsFacultyHandoff}
          onUpdateAccount={onUpdateAccount}
          onReturnToFaculty={onReturnToFaculty}
        />
      )}
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
  );
}

type CreateAccountActionsProps = Pick<
  AccountActionsProps,
  | 'request'
  | 'actionLoading'
  | 'usernameCheckMessage'
  | 'onCreateAccount'
  | 'onManualAssign'
>;
function CreateAccountActions({
  request,
  actionLoading,
  usernameCheckMessage,
  onCreateAccount,
  onManualAssign,
}: CreateAccountActionsProps) {
  return (
    <>
      <button
        onClick={onCreateAccount}
        disabled={
          actionLoading ||
          !usernameCheckMessage?.includes('available') ||
          request.isGrandfatheredAccount
        }
        className="w-full sm:w-auto bg-green-600 hover:bg-green-500 text-white font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-[background-color,box-shadow] disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
        title={
          request.isGrandfatheredAccount
            ? 'Cannot create new account - use Link to Existing Account instead'
            : !usernameCheckMessage?.includes('available')
              ? 'Please check username availability first'
              : 'Create an account in Active Directory'
        }
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
            d="M12 4v16m8-8H4"
          />
        </svg>
        {actionLoading ? 'Creating Account...' : 'Create AD Account'}
      </button>
      <button
        onClick={onManualAssign}
        disabled={actionLoading}
        className="w-full sm:w-auto bg-purple-600 hover:bg-purple-500 text-white font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-[background-color,box-shadow] disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
        title="Link this request to an existing Active Directory account"
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
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </svg>
        {actionLoading ? 'Processing...' : 'Manual Assignment'}
      </button>
    </>
  );
}

type UpdateAccountActionsProps = Pick<
  AccountActionsProps,
  | 'actionLoading'
  | 'supportsFacultyHandoff'
  | 'onUpdateAccount'
  | 'onReturnToFaculty'
>;
function UpdateAccountActions({
  actionLoading,
  supportsFacultyHandoff,
  onUpdateAccount,
  onReturnToFaculty,
}: UpdateAccountActionsProps) {
  return (
    <>
      <button
        onClick={onUpdateAccount}
        disabled={actionLoading}
        className="w-full sm:w-auto bg-orange-600 hover:bg-orange-500 text-white font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-[background-color,box-shadow] disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
        title="Update password and expiration date in Active Directory"
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
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        {actionLoading ? 'Updating...' : 'Update directory account'}
      </button>
      {supportsFacultyHandoff && (
        <button
          onClick={onReturnToFaculty}
          disabled={actionLoading}
          className="w-full sm:w-auto bg-blue-600 hover:bg-blue-500 text-white font-semibold px-6 py-3 rounded-lg shadow-sm hover:shadow transition-[background-color,box-shadow] disabled:opacity-50 disabled:cursor-not-allowed text-sm flex items-center justify-center gap-2"
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
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          {actionLoading ? 'Processing...' : 'Return to Faculty'}
        </button>
      )}
    </>
  );
}
