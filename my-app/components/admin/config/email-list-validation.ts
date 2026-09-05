const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidAddress(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}
