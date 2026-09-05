export function timingSafeCompare(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) {
    return false;
  }

  const len = a.length;
  let result = 0;

  for (let i = 0; i < len; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return result === 0;
}

const BEARER_PREFIX = 'Bearer ';

export function bearerTokenMatches(
  headerValue: string | null | undefined,
  expectedToken: string
): boolean {
  if (!headerValue || !expectedToken || !headerValue.startsWith(BEARER_PREFIX)) {
    return false;
  }
  return timingSafeCompare(headerValue.slice(BEARER_PREFIX.length), expectedToken);
}
