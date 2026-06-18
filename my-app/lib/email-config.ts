import { prisma } from './prisma';
import { validateEmail } from './validation';

/**
 * Email configuration with database-first approach
 * Falls back to environment variables if database values are not set
 */

let cachedSettings: {
  emailFrom?: string | null;
  adminEmail?: string | null;
  facultyEmail?: string | null;
  studentDirectorEmails?: string | null;
} | null = null;

let lastFetchTime = 0;
const CACHE_TTL = 60000; // 1 minute cache

function normalizeEmailValue(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

function normalizeAddressValue(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized || null;
}

function resolveEmailValue(databaseValue?: string | null, envValue?: string): string | undefined {
  return normalizeEmailValue(databaseValue) || normalizeEmailValue(envValue) || undefined;
}

function resolveAddressValue(databaseValue?: string | null, envValue?: string): string | undefined {
  return normalizeAddressValue(databaseValue) || normalizeAddressValue(envValue) || undefined;
}

/**
 * Get email configuration from database with fallback to env vars
 * Uses caching to avoid repeated database queries
 */
export async function getEmailConfig() {
  const now = Date.now();
  
  // Return cached settings if still valid
  if (cachedSettings && (now - lastFetchTime) < CACHE_TTL) {
    return {
      emailFrom: resolveAddressValue(cachedSettings.emailFrom, process.env.EMAIL_FROM),
      adminEmail: resolveEmailValue(cachedSettings.adminEmail, process.env.ADMIN_EMAIL),
      facultyEmail: resolveEmailValue(cachedSettings.facultyEmail, process.env.FACULTY_EMAIL),
      studentDirectorEmails: cachedSettings.studentDirectorEmails?.trim() || process.env.STUDENT_DIRECTOR_EMAILS?.trim(),
    };
  }

  try {
    // Fetch from database
    const settings = await prisma.systemSettings.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        emailFrom: true,
        adminEmail: true,
        facultyEmail: true,
        studentDirectorEmails: true,
      },
    });

    // Update cache
    cachedSettings = settings;
    lastFetchTime = now;

    // Return with env fallback
    return {
      emailFrom: resolveAddressValue(settings?.emailFrom, process.env.EMAIL_FROM),
      adminEmail: resolveEmailValue(settings?.adminEmail, process.env.ADMIN_EMAIL),
      facultyEmail: resolveEmailValue(settings?.facultyEmail, process.env.FACULTY_EMAIL),
      studentDirectorEmails: settings?.studentDirectorEmails?.trim() || process.env.STUDENT_DIRECTOR_EMAILS?.trim(),
    };
  } catch (error) {
    console.error('[Email Config] Failed to fetch from database, using env vars:', error);
    
    // Fallback to environment variables if database fails
    return {
      emailFrom: resolveAddressValue(null, process.env.EMAIL_FROM),
      adminEmail: resolveEmailValue(null, process.env.ADMIN_EMAIL),
      facultyEmail: resolveEmailValue(null, process.env.FACULTY_EMAIL),
      studentDirectorEmails: process.env.STUDENT_DIRECTOR_EMAILS?.trim(),
    };
  }
}

/**
 * Clear the email config cache
 * Call this after updating email settings in the database
 */
export function clearEmailConfigCache() {
  cachedSettings = null;
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
