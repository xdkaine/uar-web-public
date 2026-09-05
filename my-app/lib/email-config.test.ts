import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    systemConfigEntry: {
      findMany: mocks.findMany,
    },
    systemSettings: {
      findFirst: mocks.findFirst,
    },
  },
}));

import { clearConfigCache } from './config/resolver';
import {
  clearEmailConfigCache,
  getEmailConfig,
  getStudentDirectorEmails,
} from './email-config';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  for (const key of Object.keys(process.env)) {
    if (
      key.startsWith('EMAIL_') ||
      key.startsWith('SMTP_') ||
      key === 'ADMIN_EMAIL' ||
      key === 'FACULTY_EMAIL' ||
      key.startsWith('STUDENT_DIRECTOR')
    ) {
      delete process.env[key];
    }
  }
  clearConfigCache();
  clearEmailConfigCache();
});

describe('getEmailConfig resolution order', () => {
  it('prefers a stored configuration row over legacy columns and environment', async () => {
    process.env.EMAIL_FROM = 'env-from@example.test';
    mocks.findMany.mockResolvedValue([
      {
        key: 'email.from',
        value: 'registry-from@example.test',
      },
    ]);
    mocks.findFirst.mockResolvedValue({ emailFrom: 'legacy-from@example.test' });

    const config = await getEmailConfig();

    expect(config.emailFrom).toBe('registry-from@example.test');
  });

  it('falls back to the legacy SystemSettings column when nothing newer is configured', async () => {
    mocks.findMany.mockResolvedValue([]);
    mocks.findFirst.mockResolvedValue({
      emailFrom: 'legacy-from@example.test',
      adminEmail: 'legacy-admin@example.test',
      facultyEmail: null,
      studentDirectorEmails: 'd1@example.test, d2@example.test',
    });

    const config = await getEmailConfig();

    expect(config.emailFrom).toBe('legacy-from@example.test');
    expect(config.adminEmail).toBe('legacy-admin@example.test');
    expect(config.studentDirectorEmails).toBe('d1@example.test, d2@example.test');
  });

  it('uses environment variables when no row or legacy column exists', async () => {
    process.env.EMAIL_FROM = 'env-from@example.test';
    process.env.ADMIN_EMAIL = 'env-admin@example.test';
    process.env.FACULTY_EMAIL = 'env-faculty@example.test';
    process.env.STUDENT_DIRECTOR_EMAILS = 'sd1@example.test,sd2@example.test';
    mocks.findMany.mockResolvedValue([]);
    mocks.findFirst.mockResolvedValue(null);

    const config = await getEmailConfig();

    expect(config.emailFrom).toBe('env-from@example.test');
    expect(config.adminEmail).toBe('env-admin@example.test');
    expect(config.facultyEmail).toBe('env-faculty@example.test');
    expect(config.studentDirectorEmails).toBe('sd1@example.test,sd2@example.test');
  });

  it('parses comma-separated STUDENT_DIRECTOR_EMAILS into the registered list', async () => {
    process.env.STUDENT_DIRECTOR_EMAILS = 'a@example.test, b@example.test';
    mocks.findMany.mockResolvedValue([]);

    const config = await getEmailConfig();

    expect(config.studentDirectorEmails).toBe('a@example.test,b@example.test');
  });

  it('does not fall back when a stored address is invalid', async () => {
    process.env.EMAIL_FROM = 'env-from@example.test';
    mocks.findMany.mockResolvedValue([{ key: 'email.from', value: 42 }]);
    mocks.findFirst.mockResolvedValue({ emailFrom: 'legacy-from@example.test' });

    await expect(getEmailConfig()).rejects.toThrow('Stored configuration key email.from is invalid');
  });
});

describe('getStudentDirectorEmails', () => {
  it('splits, dedupes, and validates addresses from the registry list', async () => {
    mocks.findMany.mockResolvedValue([
      {
        key: 'email.studentDirectors',
        value: ['A@Example.test', 'b@example.test', 'not-an-email'],
      },
    ]);

    const emails = await getStudentDirectorEmails();

    expect(emails).toEqual(['a@example.test', 'b@example.test']);
  });

  it('returns an empty list when no source provides directors', async () => {
    mocks.findMany.mockResolvedValue([]);
    mocks.findFirst.mockResolvedValue(null);

    const emails = await getStudentDirectorEmails();

    expect(emails).toEqual([]);
  });
});
