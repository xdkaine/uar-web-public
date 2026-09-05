import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
  },
}));

vi.mock('@/lib/ratelimit', () => ({
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

import logger from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import {
  emitAuditActionLog,
  logAuditAction,
  sanitizeAuditDetails,
  sanitizeDatabaseText,
} from './audit-log';

describe('sanitizeDatabaseText', () => {
  it('removes null and control bytes before database writes', () => {
    expect(sanitizeDatabaseText('LDAP\0 failed\x07 hard')).toBe('LDAP failed hard');
  });

  it('truncates long text to the requested maximum length', () => {
    expect(sanitizeDatabaseText('abcdef', 4)).toBe('abcd');
  });
});

describe('sanitizeAuditDetails', () => {
  it('redacts sensitive keys recursively', () => {
    expect(
      sanitizeAuditDetails({
        username: 'admin',
        password: 'secret',
        nested: { tokenHash: 'hash', safe: true },
      })
    ).toEqual({
      username: 'admin',
      password: '[REDACTED]',
      nested: { tokenHash: '[REDACTED]', safe: true },
    });
  });

  it('redacts sensitive text patterns', () => {
    expect(sanitizeAuditDetails('password: hunter2')).toBe('[REDACTED]');
    expect(sanitizeAuditDetails('bearer abc123')).toBe('bearer [REDACTED]');
  });

  it('serializes dates and recursively sanitizes arrays', () => {
    expect(sanitizeAuditDetails([new Date('2026-05-16T00:00:00.000Z'), 'token=abc'])).toEqual([
      '2026-05-16T00:00:00.000Z',
      '[REDACTED]',
    ]);
  });
});

describe('transaction-aware audit emission', () => {
  it('can defer the operational success event until after the database commit', async () => {
    const entry = {
      action: 'assign_ticket',
      category: 'support',
      username: 'admin1',
      targetId: 'ticket-1',
    };
    vi.mocked(logger.info).mockClear();

    await logAuditAction(entry, prisma, { emitOperationalLog: false });

    expect(logger.info).not.toHaveBeenCalled();
    emitAuditActionLog(entry);
    expect(logger.info).toHaveBeenCalledWith(
      'assign_ticket',
      expect.objectContaining({ type: 'audit_log', outcome: 'success' })
    );
  });
});
