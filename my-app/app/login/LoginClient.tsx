'use client';

import { useMemo, useReducer } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Turnstile from 'react-turnstile';
import { AlertCircle, ArrowRight, ChevronLeft, Loader2, Lock, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { classifyPasswordChangeResponse } from '@/lib/auth/password-change-response';
import { fetchWithCsrf, refreshCsrfToken } from '@/lib/csrf';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { getLoginRedirectTarget } from '@/lib/safe-redirect';

type SignInMethodId = 'oidc' | 'native_ad' | 'local_break_glass';
type CredentialSignInMethod = Exclude<SignInMethodId, 'oidc'>;

export interface SignInMethod {
  id: SignInMethodId;
  displayName: string;
  description: string;
}

interface LoginResponse {
  action?: string;
  reason?: string;
  message?: string;
  error?: string;
  issues?: string[];
  isAdmin?: boolean;
  requiresLogin?: boolean;
}

interface LoginClientProps {
  methods: SignInMethod[];
  redirectTo: string | null;
  queryErrorReason: string | null;
  initialError: string;
}

type LoginState = {
  methods: SignInMethod[];
  selectedMethod: CredentialSignInMethod | null;
  ready: boolean;
  loading: boolean;
  error: string;
  credentials: { username: string; password: string };
  turnstileToken: string;
  turnstileKey: number;
  passwordChangeRequired: boolean;
  passwordChangeIssues: string[];
  passwordChange: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  };
};

function loginStateReducer(
  state: LoginState,
  patch: Partial<LoginState>,
): LoginState {
  return { ...state, ...patch };
}

function getQueryError(reason: string | null): string {
  const errors: Record<string, string> = {
    oidc_unavailable:
      'The configured auth service is unavailable. Choose another enabled sign-in method or try again.',
    oidc_start_failed:
      'The auth-service sign-in could not be completed. Choose another enabled method or try again.',
    oidc_failed:
      'The auth-service sign-in could not be completed. Choose another enabled method or try again.',
    oidc_disabled: 'Auth-service sign-in is not currently enabled.',
    logins_disabled: 'Sign-in is currently disabled by an administrator.',
  };
  return reason ? errors[reason] || '' : '';
}

function getLoginDescription(
  passwordChangeRequired: boolean,
  showChooser: boolean,
  selectedMethod: CredentialSignInMethod | null,
): string {
  if (passwordChangeRequired)
    return 'Update your Active Directory password to continue.';
  if (showChooser) return 'Choose an identity source.';
  if (selectedMethod === 'native_ad')
    return 'Use your Active Directory username and password.';
  if (selectedMethod === 'local_break_glass')
    return 'Use an approved portal local account.';
  return 'Checking available identity sources.';
}

function getInitialLoginState(
  availableMethods: SignInMethod[],
  initialError: string,
): LoginState {
  const onlyMethod = availableMethods.length === 1 ? availableMethods[0] : null;
  return {
    methods: availableMethods,
    selectedMethod:
      onlyMethod && onlyMethod.id !== 'oidc' ? onlyMethod.id : null,
    ready: true,
    loading: false,
    error: initialError,
    credentials: { username: '', password: '' },
    turnstileToken: '',
    turnstileKey: 0,
    passwordChangeRequired: false,
    passwordChangeIssues: [],
    passwordChange: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
  };
}

function getLoginView(
  state: LoginState,
  queryErrorReason: string | null,
  redirectTo: string | null,
) {
  const oidcFailure = new Set([
    'oidc_unavailable',
    'oidc_start_failed',
    'oidc_failed',
  ]).has(queryErrorReason || '');
  const {
    methods,
    selectedMethod,
    ready,
    error,
    passwordChangeRequired,
    passwordChangeIssues,
    passwordChange,
    credentials,
  } = state;
  const passwordValidation = validatePasswordPolicy(
    passwordChange.newPassword,
    { username: credentials.username.trim() },
  );
  const showChooser =
    ready && !selectedMethod && !passwordChangeRequired && methods.length > 1;
  return {
    oidcTarget: redirectTo
      ? `/api/auth/oidc/login?redirect=${encodeURIComponent(redirectTo)}`
      : '/api/auth/oidc/login',
    displayedError: error || getQueryError(queryErrorReason),
    showChooser,
    showOidcRetry:
      ready &&
      !selectedMethod &&
      methods.length === 1 &&
      methods[0]?.id === 'oidc' &&
      oidcFailure,
    passwordValidation,
    visiblePasswordIssues:
      passwordChangeIssues.length > 0
        ? passwordChangeIssues
        : passwordChange.newPassword
          ? passwordValidation.issues
          : [],
    passwordsMatch:
      passwordChange.newPassword === passwordChange.confirmPassword,
    description: getLoginDescription(
      passwordChangeRequired,
      showChooser,
      selectedMethod,
    ),
  };
}

type LoginBodyProps = {
  ready: boolean;
  showChooser: boolean;
  methods: SignInMethod[];
  chooseMethod: (method: SignInMethod) => void;
  showOidcRetry: boolean;
  oidcTarget: string;
  passwordChangeRequired: boolean;
  handlePasswordChange: React.FormEventHandler<HTMLFormElement>;
  credentials: LoginState['credentials'];
  passwordChange: LoginState['passwordChange'];
  patchState: LoginPatch;
  visiblePasswordIssues: string[];
  turnstileKey: number;
  loading: boolean;
  turnstileToken: string;
  passwordsMatch: boolean;
  selectedMethod: CredentialSignInMethod | null;
  handleSubmit: React.FormEventHandler<HTMLFormElement>;
  returnToChooser: () => void;
  resetTurnstile: () => void;
  error: string;
};

function LoadingIdentitySources() {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Loading identity sources…
    </div>
  );
}

function IdentitySourceChooser({
  methods,
  chooseMethod,
}: Pick<LoginBodyProps, 'methods' | 'chooseMethod'>) {
  return (
    <ul className="divide-y rounded-md border" aria-label="Identity sources">
      {methods.map((method) => (
        <li key={method.id}>
          <button
            type="button"
            onClick={() => chooseMethod(method)}
            className="group flex w-full items-center gap-4 px-4 py-4 text-left first:rounded-t-md last:rounded-b-md hover:bg-muted/50 focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-medium text-foreground">
                {method.displayName}
              </span>
              {method.description && (
                <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                  {method.description}
                </span>
              )}
            </span>
            <ArrowRight
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

function PasswordChangeForm({
  credentials,
  passwordChange,
  patchState,
  visiblePasswordIssues,
  turnstileKey,
  loading,
  turnstileToken,
  passwordsMatch,
  handlePasswordChange,
  resetTurnstile,
}: Pick<
  LoginBodyProps,
  | 'credentials'
  | 'passwordChange'
  | 'patchState'
  | 'visiblePasswordIssues'
  | 'turnstileKey'
  | 'loading'
  | 'turnstileToken'
  | 'passwordsMatch'
  | 'handlePasswordChange'
  | 'resetTurnstile'
>) {
  return (
    <form onSubmit={handlePasswordChange} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="password-change-username">Username</Label>
        <div className="relative">
          <User className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <Input
            id="password-change-username"
            className="pl-10"
            value={credentials.username}
            disabled
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="current-password">Current password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <Input
            id="current-password"
            className="pl-10"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            value={passwordChange.currentPassword}
            onChange={(event) =>
              patchState({
                passwordChange: {
                  ...passwordChange,
                  currentPassword: event.target.value,
                },
              })
            }
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-password">New password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <Input
            id="new-password"
            className="pl-10"
            type="password"
            autoComplete="new-password"
            required
            value={passwordChange.newPassword}
            onChange={(event) =>
              patchState({
                passwordChange: {
                  ...passwordChange,
                  newPassword: event.target.value,
                },
              })
            }
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm-password">Confirm new password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <Input
            id="confirm-password"
            className="pl-10"
            type="password"
            autoComplete="new-password"
            required
            value={passwordChange.confirmPassword}
            onChange={(event) =>
              patchState({
                passwordChange: {
                  ...passwordChange,
                  confirmPassword: event.target.value,
                },
              })
            }
          />
        </div>
      </div>
      {visiblePasswordIssues.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-destructive">
          {visiblePasswordIssues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
      <Turnstile
        key={turnstileKey}
        sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''}
        onVerify={(turnstileToken) => patchState({ turnstileToken })}
        onExpire={() => patchState({ turnstileToken: '' })}
        onError={() => patchState({ turnstileToken: '' })}
      />
      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={loading || !turnstileToken || !passwordsMatch}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Update password and sign in
        {!loading && <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={() => {
          patchState({ passwordChangeRequired: false, error: '' });
          resetTurnstile();
        }}
      >
        Cancel password change
      </Button>
    </form>
  );
}

function CredentialSignInForm({
  methods,
  credentials,
  patchState,
  turnstileKey,
  loading,
  turnstileToken,
  selectedMethod,
  handleSubmit,
  returnToChooser,
}: Pick<
  LoginBodyProps,
  | 'methods'
  | 'credentials'
  | 'patchState'
  | 'turnstileKey'
  | 'loading'
  | 'turnstileToken'
  | 'selectedMethod'
  | 'handleSubmit'
  | 'returnToChooser'
>) {
  if (!selectedMethod) return null;
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="username">Username</Label>
        <div className="relative">
          <User className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <Input
            id="username"
            className="pl-10"
            autoComplete="username"
            required
            autoFocus
            placeholder={
              selectedMethod === 'local_break_glass'
                ? 'name@local'
                : 'Directory username'
            }
            value={credentials.username}
            onChange={(event) =>
              patchState({
                credentials: { ...credentials, username: event.target.value },
              })
            }
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <div className="relative">
          <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" aria-hidden="true" />
          <Input
            id="password"
            className="pl-10"
            type="password"
            autoComplete="current-password"
            required
            value={credentials.password}
            onChange={(event) =>
              patchState({
                credentials: { ...credentials, password: event.target.value },
              })
            }
          />
        </div>
      </div>
      <Turnstile
        key={turnstileKey}
        sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''}
        onVerify={(turnstileToken) => patchState({ turnstileToken })}
        onExpire={() => patchState({ turnstileToken: '' })}
        onError={() => patchState({ turnstileToken: '' })}
      />
      <Button
        type="submit"
        className="w-full"
        size="lg"
        disabled={loading || !turnstileToken}
      >
        {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Sign in
        {!loading && <ArrowRight className="ml-2 h-5 w-5" aria-hidden="true" />}
      </Button>
      {methods.length > 1 && (
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={returnToChooser}
        >
          <ChevronLeft className="mr-2 h-4 w-4" />
          Choose another identity source
        </Button>
      )}
    </form>
  );
}

function OidcRetryButton({
  oidcTarget,
  methods,
}: Pick<LoginBodyProps, 'oidcTarget' | 'methods'>) {
  return (
    <Button
      type="button"
      className="w-full"
      size="lg"
      onClick={() => window.location.assign(oidcTarget)}
    >
      Try {methods[0].displayName} again
      <ArrowRight className="ml-2 h-4 w-4" />
    </Button>
  );
}

function ReloadSignInMethods() {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full"
      onClick={() => window.location.reload()}
    >
      Reload sign-in methods
    </Button>
  );
}

function EmptyLoginBody() {
  return null;
}

const LOGIN_BODY_COMPONENTS = {
  loading: LoadingIdentitySources,
  chooser: IdentitySourceChooser,
  oidcRetry: OidcRetryButton,
  passwordChange: PasswordChangeForm,
  credentials: CredentialSignInForm,
  reload: ReloadSignInMethods,
  empty: EmptyLoginBody,
};

function getLoginBodyMode(
  props: LoginBodyProps,
): keyof typeof LOGIN_BODY_COMPONENTS {
  if (!props.ready) return 'loading';
  if (props.showChooser) return 'chooser';
  if (props.showOidcRetry) return 'oidcRetry';
  if (props.passwordChangeRequired) return 'passwordChange';
  if (props.selectedMethod) return 'credentials';
  if (props.error) return 'reload';
  return 'empty';
}

function LoginBody(props: LoginBodyProps): React.ReactNode {
  const Body = LOGIN_BODY_COMPONENTS[getLoginBodyMode(props)];
  return <Body {...props} />;
}

type LoginPatch = (patch: Partial<LoginState>) => void;

function resetLoginTurnstile(turnstileKey: number, patchState: LoginPatch) {
  patchState({ turnstileKey: turnstileKey + 1, turnstileToken: '' });
}

function chooseLoginMethod({
  method,
  oidcTarget,
  patchState,
  resetTurnstile,
}: {
  method: SignInMethod;
  oidcTarget: string;
  patchState: LoginPatch;
  resetTurnstile: () => void;
}) {
  if (method.id === 'oidc') {
    window.location.assign(oidcTarget);
    return;
  }
  patchState({
    selectedMethod: method.id,
    credentials: { username: '', password: '' },
    passwordChangeRequired: false,
    passwordChangeIssues: [],
    error: '',
  });
  resetTurnstile();
}

function returnToLoginMethodChooser(
  patchState: LoginPatch,
  resetTurnstile: () => void,
) {
  patchState({
    selectedMethod: null,
    credentials: { username: '', password: '' },
    passwordChangeRequired: false,
    passwordChange: {
      currentPassword: '',
      newPassword: '',
      confirmPassword: '',
    },
    passwordChangeIssues: [],
    error: '',
  });
  resetTurnstile();
}

async function finishLogin({
  data,
  redirectTo,
  navigate,
}: {
  data: LoginResponse;
  redirectTo: string | null;
  navigate: (target: string) => void;
}) {
  await refreshCsrfToken(true);
  window.dispatchEvent(new Event('authStateChanged'));
  navigate(getLoginRedirectTarget(redirectTo, Boolean(data.isAdmin)));
}

async function submitCredentials(
  event: React.FormEvent,
  options: {
    selectedMethod: CredentialSignInMethod | null;
    credentials: LoginState['credentials'];
    turnstileToken: string;
    patchState: LoginPatch;
    resetTurnstile: () => void;
    completeLogin: (data: LoginResponse) => Promise<void>;
  },
) {
  event.preventDefault();
  const {
    selectedMethod,
    credentials,
    turnstileToken,
    patchState,
    resetTurnstile,
    completeLogin,
  } = options;
  if (!selectedMethod) return;
  patchState({ loading: true, error: '' });
  try {
    const response = await fetchWithCsrf('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...credentials,
        turnstileToken,
        signInMethod: selectedMethod,
      }),
    });
    const data = (await response.json()) as LoginResponse;
    if (!response.ok) {
      if (response.status === 409 && data.action === 'METHOD_DISABLED') {
        patchState({ methods: [], selectedMethod: null, ready: false });
        window.location.reload();
        return;
      }
      if (
        response.status === 409 &&
        data.action === 'PASSWORD_CHANGE_REQUIRED'
      ) {
        patchState({
          passwordChangeRequired: true,
          passwordChange: {
            currentPassword: '',
            newPassword: '',
            confirmPassword: '',
          },
          credentials: { ...credentials, password: '' },
          error:
            data.message ||
            'Your account requires a new password before sign-in can continue.',
        });
        resetTurnstile();
        return;
      }
      throw new Error(data.error || 'Authentication failed');
    }
    await completeLogin(data);
  } catch (error) {
    patchState({
      error:
        error instanceof Error
          ? error.message
          : 'Sign-in failed. Please try again.',
    });
    resetTurnstile();
  } finally {
    patchState({ loading: false });
  }
}

async function submitPasswordChange(
  event: React.FormEvent,
  options: {
    passwordChange: LoginState['passwordChange'];
    credentials: LoginState['credentials'];
    turnstileToken: string;
    passwordsMatch: boolean;
    passwordValidation: ReturnType<typeof validatePasswordPolicy>;
    patchState: LoginPatch;
    resetTurnstile: () => void;
    returnToChooser: () => void;
    completeLogin: (data: LoginResponse) => Promise<void>;
  },
) {
  event.preventDefault();
  const {
    passwordChange,
    credentials,
    turnstileToken,
    passwordsMatch,
    passwordValidation,
    patchState,
    resetTurnstile,
    returnToChooser,
    completeLogin,
  } = options;
  patchState({ error: '', passwordChangeIssues: [] });
  if (
    !passwordChange.currentPassword ||
    !passwordChange.newPassword ||
    !passwordChange.confirmPassword
  )
    return patchState({ error: 'All password fields are required.' });
  if (!passwordsMatch)
    return patchState({ error: 'New passwords do not match.' });
  if (!passwordValidation.isValid)
    return patchState({
      error: 'New password does not meet requirements.',
      passwordChangeIssues: passwordValidation.issues,
    });
  if (!turnstileToken)
    return patchState({
      error: 'Complete the security check before updating your password.',
    });
  patchState({ loading: true });
  try {
    const response = await fetchWithCsrf(
      '/api/auth/complete-required-password-change',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...passwordChange, turnstileToken }),
      },
    );
    const data = (await response.json()) as LoginResponse;
    if (response.status === 409 && data.action === 'METHOD_DISABLED') {
      returnToChooser();
      patchState({
        error:
          data.error || 'Direct Active Directory sign-in is no longer enabled.',
      });
      return;
    }
    const decision = classifyPasswordChangeResponse(
      response.ok,
      response.status,
      data,
    );
    if (decision.kind === 'requires_login') {
      patchState({
        passwordChangeRequired: false,
        passwordChange: {
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
        },
        credentials: { ...credentials, password: '' },
        error: decision.message,
      });
      resetTurnstile();
      return;
    }
    if (decision.kind === 'oidc_required') return returnToChooser();
    if (decision.kind === 'error') {
      patchState({ passwordChangeIssues: decision.issues });
      throw new Error(decision.message);
    }
    await completeLogin(data);
  } catch (error) {
    patchState({
      error: error instanceof Error ? error.message : 'Password change failed.',
    });
    resetTurnstile();
  } finally {
    patchState({ loading: false });
  }
}

export default function LoginClient({
  methods: initialMethods,
  redirectTo,
  queryErrorReason,
  initialError,
}: LoginClientProps) {
  const router = useRouter();
  const [state, patchState] = useReducer(
    loginStateReducer,
    initialMethods,
    (availableMethods): LoginState =>
      getInitialLoginState(availableMethods, initialError),
  );
  const {
    methods,
    selectedMethod,
    ready,
    loading,
    error,
    credentials,
    turnstileToken,
    turnstileKey,
    passwordChangeRequired,
    passwordChange,
  } = state;
  const {
    oidcTarget,
    displayedError,
    showChooser,
    showOidcRetry,
    passwordValidation,
    visiblePasswordIssues,
    passwordsMatch,
    description,
  } = useMemo(
    () => getLoginView(state, queryErrorReason, redirectTo),
    [state, queryErrorReason, redirectTo],
  );

  const resetTurnstile = () => {
    resetLoginTurnstile(turnstileKey, patchState);
  };

  const chooseMethod = (method: SignInMethod) => {
    chooseLoginMethod({ method, oidcTarget, patchState, resetTurnstile });
  };

  const returnToChooser = () => {
    returnToLoginMethodChooser(patchState, resetTurnstile);
  };

  const completeLogin = async (data: LoginResponse) => {
    await finishLogin({ data, redirectTo, navigate: router.push });
  };

  const handleSubmit = (event: React.FormEvent) =>
    submitCredentials(event, {
      selectedMethod,
      credentials,
      turnstileToken,
      patchState,
      resetTurnstile,
      completeLogin,
    });

  const handlePasswordChange = (event: React.FormEvent) =>
    submitPasswordChange(event, {
      passwordChange,
      credentials,
      turnstileToken,
      passwordsMatch,
      passwordValidation,
      patchState,
      resetTurnstile,
      returnToChooser,
      completeLogin,
    });

  const classicCredentialDesign = selectedMethod !== null || passwordChangeRequired;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-8 sm:py-12">
      <div className="w-full max-w-lg space-y-5">
        <Link
          href="/"
          className="flex items-center justify-center gap-2 text-sm font-medium text-foreground/80 hover:text-foreground hover:underline"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Home
        </Link>

        <Card className={classicCredentialDesign ? 'border-2 shadow-xl' : 'border shadow-sm'}>
          <CardHeader className={classicCredentialDesign ? 'space-y-2 text-center' : 'space-y-1 border-b'}>
            {classicCredentialDesign && (
              <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-primary sm:h-16 sm:w-16">
                <Lock className="h-7 w-7 text-primary-foreground sm:h-8 sm:w-8" aria-hidden="true" />
              </div>
            )}
            <CardTitle>
              <h1 className={classicCredentialDesign ? 'text-2xl font-bold text-foreground sm:text-3xl' : 'text-2xl font-semibold tracking-tight'}>
                {passwordChangeRequired ? 'Set new password' : 'Sign in'}
              </h1>
            </CardTitle>
            <CardDescription className={classicCredentialDesign ? 'text-sm sm:text-base' : undefined}>{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {displayedError && (
              <div
                role="alert"
                className="flex gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>{displayedError}</p>
              </div>
            )}
            {redirectTo && (
              <p className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                After sign-in, you will return to the requested page.
              </p>
            )}

            <LoginBody
              {...{
                ready,
                showChooser,
                methods,
                chooseMethod,
                showOidcRetry,
                oidcTarget,
                passwordChangeRequired,
                handlePasswordChange,
                credentials,
                passwordChange,
                patchState,
                visiblePasswordIssues,
                turnstileKey,
                loading,
                turnstileToken,
                passwordsMatch,
                selectedMethod,
                handleSubmit,
                returnToChooser,
                resetTurnstile,
                error,
              }}
            />
          </CardContent>
          <CardFooter className="flex flex-col gap-2 border-t pt-5 text-center text-xs text-muted-foreground">
            <p>
              Don&apos;t have an account?{' '}
              <Link
                href="/"
                className="font-medium text-primary hover:underline"
              >
                Request Access
              </Link>
            </p>
            <p>
              <Link
                href="/forgot-password"
                className="font-medium text-primary hover:underline"
              >
                Forgot your password?
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    </main>
  );
}
