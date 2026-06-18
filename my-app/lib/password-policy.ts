export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_ALLOWED_SPECIAL_CHARS = '!@#$%^&*()_+-=[]{}|;:,.<>?/~';

export interface PasswordValidationContext {
  username?: string | null;
  email?: string | null;
  fullName?: string | null;
}

export interface PasswordValidationResult {
  isValid: boolean;
  issues: string[];
}

const ALLOWED_SPECIAL_CHARS = new Set(PASSWORD_ALLOWED_SPECIAL_CHARS.split(''));
const ALPHANUMERIC_PATTERN = /^[A-Za-z0-9]$/;
const CONTROLS_PATTERN = /[\x00-\x1F\x7F]/;

export function isPasswordCharacterAllowed(char: string): boolean {
  return ALPHANUMERIC_PATTERN.test(char) || ALLOWED_SPECIAL_CHARS.has(char);
}

function normalizeFragment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function addContextFragment(fragments: Set<string>, value?: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return;
  }

  const normalized = normalizeFragment(trimmed);
  if (trimmed.length >= 3) {
    fragments.add(trimmed.toLowerCase());
  }
  if (normalized.length >= 3) {
    fragments.add(normalized);
  }
}

function getContextFragments(context?: PasswordValidationContext): string[] {
  const fragments = new Set<string>();

  addContextFragment(fragments, context?.username);
  context?.username
    ?.split(/[^A-Za-z0-9]+/)
    .forEach((part) => addContextFragment(fragments, part));

  const emailPrefix = context?.email?.split('@')[0];
  addContextFragment(fragments, emailPrefix);
  emailPrefix
    ?.split(/[^A-Za-z0-9]+/)
    .forEach((part) => addContextFragment(fragments, part));

  const nameTokens = context?.fullName?.split(/[^A-Za-z0-9]+/) ?? [];
  nameTokens.forEach((part) => addContextFragment(fragments, part));

  return Array.from(fragments);
}

function containsContextFragment(password: string, context?: PasswordValidationContext): boolean {
  const lowerPassword = password.toLowerCase();
  const normalizedPassword = normalizeFragment(password);

  return getContextFragments(context).some((fragment) => {
    const normalizedFragment = normalizeFragment(fragment);
    return (
      lowerPassword.includes(fragment) ||
      (normalizedFragment.length >= 3 && normalizedPassword.includes(normalizedFragment))
    );
  });
}

export function validatePasswordPolicy(
  password: string,
  context?: PasswordValidationContext
): PasswordValidationResult {
  const issues: string[] = [];

  if (password.includes('\x00')) {
    issues.push('Password cannot contain null characters');
  }

  if (CONTROLS_PATTERN.test(password)) {
    issues.push('Password cannot contain control characters');
  }

  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push(`Password must be at least ${PASSWORD_MIN_LENGTH} characters long`);
  }

  if (password.length > PASSWORD_MAX_LENGTH) {
    issues.push(`Password must not exceed ${PASSWORD_MAX_LENGTH} characters`);
  }

  if (!/[a-z]/.test(password)) {
    issues.push('Password must contain at least one lowercase letter');
  }

  if (!/[A-Z]/.test(password)) {
    issues.push('Password must contain at least one uppercase letter');
  }

  if (!/[0-9]/.test(password)) {
    issues.push('Password must contain at least one number');
  }

  if (![...password].some((char) => ALLOWED_SPECIAL_CHARS.has(char))) {
    issues.push(
      `Password must contain at least one allowed special character (${PASSWORD_ALLOWED_SPECIAL_CHARS})`
    );
  }

  if (![...password].every(isPasswordCharacterAllowed)) {
    issues.push(
      `Password can only contain letters, numbers, and these special characters: ${PASSWORD_ALLOWED_SPECIAL_CHARS}`
    );
  }

  if (containsContextFragment(password, context)) {
    issues.push('Password cannot contain your username, email prefix, or name');
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
}
