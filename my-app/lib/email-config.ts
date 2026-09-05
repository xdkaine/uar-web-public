import { prisma } from './prisma';
import { validateEmail } from './validation';
import { getConfigValue } from './config/resolver';

/**
 * Email configuration resolution (ADR-0005 precedence):
 *
 *   1. persisted configuration row (`email.*` keys in SystemConfigEntry)
 *   2. legacy environment variable (EMAIL_FROM, ADMIN_EMAIL, ...)
 *   3. legacy SystemSettings columns (the pre-registry store, read-only)
 *   4. undefined - callers keep their historical missing-configuration errors
 *
 * Steps 1 and 2 are handled by the shared resolver; this module adds the
 * step-3 fallback so existing deployments keep sending mail unchanged until
 * an operator saves overrides in System Configuration.
 */

interface LegacyAddressColumns {
  emailFrom?: string | null;
  adminEmail?: string | null;
  facultyEmail?: string | null;
  studentDirectorEmails?: string | null;
}

let cachedLegacy: LegacyAddressColumns | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 60000; // 1 minute cache for the legacy fallback store

function normalizeEmailValue(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function normalizeAddressValue(value?: string | null): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

async function loadLegacyColumns(): Promise<LegacyAddressColumns | null> {
  const now = Date.now();
  if (cachedLegacy && now - lastFetchTime < CACHE_TTL) {
    return cachedLegacy;
  }
  try {
    cachedLegacy = await prisma.systemSettings.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        emailFrom: true,
        adminEmail: true,
        facultyEmail: true,
        studentDirectorEmails: true,
      },
    });
    lastFetchTime = now;
  } catch (error) {
    console.error('[Email Config] Failed to fetch legacy settings, using env vars:', error);
    return null;
  }
  return cachedLegacy;
}

/**
 * Resolve one routing address through the registry, falling back to the
 * legacy SystemSettings column when neither a stored override nor the
 * environment provides a value.
 */
async function resolveAddress(key: string, legacyColumn: keyof LegacyAddressColumns): Promise<string | undefined> {
  const resolved = await getConfigValue<unknown>(key);
  // The resolver returns safeDefault ('' for address strings / [] for lists)
  // when no stored row or environment value exists; only that absence may
  // reach the legacy store. Invalid/unavailable saved configuration fails closed.
  const isEmptyDefault =
    resolved === '' || (Array.isArray(resolved) && resolved.length === 0);
  if (!isEmptyDefault) {
    return typeof resolved === 'string' ? normalizeAddressValue(resolved) : String(resolved);
  }

  const legacy = await loadLegacyColumns();
  const legacyValue = legacy?.[legacyColumn];
  if (legacyColumn === 'emailFrom') {
    return normalizeAddressValue(legacyValue) || undefined;
  }
  return normalizeEmailValue(legacyValue) || undefined;
}

/**
 * Get email configuration. Signature and shape are unchanged from the
 * legacy implementation; only the resolution order moved behind the
 * configuration registry.
 */
export async function getEmailConfig() {
  const [emailFrom, adminEmail, facultyEmail] = await Promise.all([
    resolveAddress('email.from', 'emailFrom'),
    resolveAddress('email.admin', 'adminEmail'),
    resolveAddress('email.faculty', 'facultyEmail'),
  ]);

  let studentDirectorEmails: string | undefined;
  const list = await getConfigValue<string[]>('email.studentDirectors');
  if (Array.isArray(list) && list.length > 0) {
    studentDirectorEmails = list.join(',');
  }
  if (!studentDirectorEmails) {
    const legacy = await loadLegacyColumns();
    studentDirectorEmails = legacy?.studentDirectorEmails?.trim() || undefined;
  }

  return { emailFrom, adminEmail, facultyEmail, studentDirectorEmails };
}

/**
 * Clear the legacy fallback cache. Stored overrides live in the resolver
 * cache (cleared by the configuration write path); call this after updating
 * the old SystemSettings address columns directly.
 */
export function clearEmailConfigCache() {
  cachedLegacy = null;
  lastFetchTime = 0;
}

/**
 * Get student director emails as an array
 */
export async function getStudentDirectorEmails(): Promise<string[]> {
  const config = await getEmailConfig();
  const emailsStr = config.studentDirectorEmails || '';
  return Array.from(new Set(
    emailsStr
      .split(',')
      .map((email: string) => email.trim().toLowerCase())
      .filter((email: string) => email && validateEmail(email))
  ));
}
