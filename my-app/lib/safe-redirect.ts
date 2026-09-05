const FIXED_APPLICATION_ORIGIN = 'https://application.invalid';
const CONTROL_OR_BACKSLASH = /[\u0000-\u001f\u007f\\]/;

export function getSafeRelativeRedirect(value: string | null | undefined): string | null {
  if (!value || value !== value.trim() || !value.startsWith('/') || value.startsWith('//')) {
    return null;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }

  if (CONTROL_OR_BACKSLASH.test(value) || CONTROL_OR_BACKSLASH.test(decoded) || decoded.startsWith('//')) {
    return null;
  }

  const parsed = new URL(value, FIXED_APPLICATION_ORIGIN);
  if (parsed.origin !== FIXED_APPLICATION_ORIGIN) {
    return null;
  }

  const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return normalized.startsWith('/') && !normalized.startsWith('//') ? normalized : null;
}

export function getLoginRedirectTarget(
  requestedRedirect: string | null | undefined,
  isAdmin: boolean
): string {
  const safeRedirect = getSafeRelativeRedirect(requestedRedirect);

  if (!safeRedirect) {
    return isAdmin ? '/admin' : '/instructions';
  }

  if (safeRedirect.startsWith('/admin') && !isAdmin) {
    return '/instructions';
  }

  return safeRedirect;
}
