import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  probe: vi.fn(),
  queryRaw: vi.fn(),
  findAudit: vi.fn(),
  logAuditAction: vi.fn(),
}));

const values = new Map<string, string>();
const counters = new Map<string, number>();
const redis = {
  incr: vi.fn(async (key: string) => {
    const count = (counters.get(key) ?? 0) + 1;
    counters.set(key, count);
    values.set(key, String(count));
    return count;
  }),
  incrementWithFirstExpiry: vi.fn(async (key: string) => {
    const count = (counters.get(key) ?? 0) + 1;
    counters.set(key, count);
    values.set(key, String(count));
    return count;
  }),
  expire: vi.fn(async () => 1),
  ttl: vi.fn(async () => 30),
  get: vi.fn(async (key: string) => values.get(key) ?? null),
  setWithExpiry: vi.fn(async (key: string, value: string) => {
    values.set(key, value);
    return 'OK';
  }),
  setIfAbsentWithExpiry: vi.fn(async (key: string, value: string) => {
    if (values.has(key)) return false;
    values.set(key, value);
    return true;
  }),
  setIfOwnerWithExpiry: vi.fn(async (
    ownerKey: string,
    expectedOwner: string,
    targetKey: string,
    value: string
  ) => {
    if (values.get(ownerKey) !== expectedOwner || values.has(targetKey)) return false;
    values.set(targetKey, value);
    return true;
  }),
  deleteIfValue: vi.fn(async (key: string, expectedValue: string) => {
    if (values.get(key) !== expectedValue) return false;
    values.delete(key);
    counters.delete(key);
    return true;
  }),
  del: vi.fn(async (key: string) => {
    const existed = values.delete(key);
    counters.delete(key);
    return existed ? 1 : 0;
  }),
  scanKeys: vi.fn(async () => []),
};

vi.mock('@/lib/auth/oidc', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oidc')>();
  return { ...actual, probeOidcProviderAvailability: mocks.probe };
});
vi.mock('@/lib/ratelimit', () => ({ getRequiredAuthRedisClient: async () => redis }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    $transaction: async (callback: (transaction: unknown) => Promise<unknown>) => callback({ auditLog: {} }),
    auditLog: { findFirst: mocks.findAudit },
  },
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: {
    OIDC_OUTAGE_FALLBACK_OPEN_AUTHORIZED: 'oidc_outage_fallback_open_authorized',
    OIDC_OUTAGE_FALLBACK_OPENED: 'oidc_outage_fallback_opened',
    OIDC_OUTAGE_FALLBACK_ACTIVATION_FAILED: 'oidc_outage_fallback_activation_failed',
    OIDC_OUTAGE_FALLBACK_RECOVERED: 'oidc_outage_fallback_recovered',
    OIDC_OUTAGE_FALLBACK_CLOSED_FAIL_CLOSED: 'oidc_outage_fallback_closed_fail_closed',
  },
  AuditCategories: { AUTH: 'auth' },
  logAuditAction: mocks.logAuditAction,
}));
vi.mock('@/lib/logger', () => ({
  appLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { OidcProviderAvailabilityError } from './oidc';
import {
  evaluateOidcSignInDecision,
  getActiveOidcOutageCircuit,
  recordOidcStartFailure,
} from './outage-fallback';

describe('OIDC outage fallback circuit', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    values.clear();
    counters.clear();
    process.env.AUTH_OIDC_OUTAGE_FALLBACK = 'native_and_local';
    process.env.OIDC_INTERNAL_ISSUER_URL = 'http://auth-service:3003';
    mocks.queryRaw.mockResolvedValue([{ ok: 1 }]);
    mocks.findAudit.mockResolvedValue({ id: 'audit-opened' });
    mocks.logAuditAction.mockResolvedValue(undefined);
    mocks.probe.mockResolvedValue({
      available: false,
      reason: 'connection_refused',
      qualifiesForOutageFallback: true,
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('opens one distributed lease only after three qualifying failures', async () => {
    await expect(evaluateOidcSignInDecision()).resolves.toEqual({ kind: 'oidc_primary' });
    await expect(evaluateOidcSignInDecision()).resolves.toEqual({ kind: 'oidc_primary' });
    const opened = await evaluateOidcSignInDecision();

    expect(opened.kind).toBe('outage_fallback');
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.logAuditAction).toHaveBeenCalledTimes(2);
    expect(redis.setIfOwnerWithExpiry).toHaveBeenCalledWith(
      'auth:oidc-outage-fallback:opening',
      expect.any(String),
      'auth:oidc-outage-fallback:circuit',
      expect.any(String),
      300,
      30
    );
    await expect(getActiveOidcOutageCircuit()).resolves.toMatchObject({
      reason: 'connection_refused',
    });
  });

  it('never publishes a readable circuit before the opening audit succeeds', async () => {
    await evaluateOidcSignInDecision();
    await evaluateOidcSignInDecision();
    mocks.logAuditAction.mockRejectedValueOnce(new Error('audit unavailable'));

    await expect(evaluateOidcSignInDecision()).rejects.toThrow('audit unavailable');
    await expect(getActiveOidcOutageCircuit()).resolves.toBeNull();
    expect([...values.keys()]).not.toContain('auth:oidc-outage-fallback:circuit');
  });

  it('uses one atomic rolling-window counter operation for failure evidence', async () => {
    await evaluateOidcSignInDecision();

    expect(redis.incrementWithFirstExpiry).toHaveBeenCalledWith(
      'auth:oidc-outage-fallback:failures',
      30
    );
    expect(redis.incr).not.toHaveBeenCalled();
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('audits activation failure without publishing when opener ownership is lost', async () => {
    await evaluateOidcSignInDecision();
    await evaluateOidcSignInDecision();
    redis.setIfOwnerWithExpiry.mockResolvedValueOnce(false);

    await expect(evaluateOidcSignInDecision()).resolves.toEqual({ kind: 'oidc_primary' });
    await expect(getActiveOidcOutageCircuit()).resolves.toBeNull();
    expect(mocks.logAuditAction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        action: 'oidc_outage_fallback_activation_failed',
        outcome: 'failure',
      }),
      undefined
    );
  });

  it('revokes a newly published circuit when its activation audit fails', async () => {
    await evaluateOidcSignInDecision();
    await evaluateOidcSignInDecision();
    mocks.logAuditAction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('activation audit unavailable'));

    await expect(evaluateOidcSignInDecision()).rejects.toThrow('activation audit unavailable');
    await expect(getActiveOidcOutageCircuit()).resolves.toBeNull();
    expect(redis.deleteIfValue).toHaveBeenCalledWith(
      'auth:oidc-outage-fallback:circuit',
      expect.stringContaining('"correlationId"')
    );
  });

  it('keeps an unaudited circuit unreadable when Redis rollback also fails', async () => {
    await evaluateOidcSignInDecision();
    await evaluateOidcSignInDecision();
    mocks.logAuditAction
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('activation audit unavailable'));
    redis.deleteIfValue.mockRejectedValueOnce(new Error('redis rollback unavailable'));
    mocks.findAudit.mockResolvedValue(null);

    await expect(evaluateOidcSignInDecision()).rejects.toThrow('activation audit unavailable');
    expect(values.has('auth:oidc-outage-fallback:circuit')).toBe(true);
    await expect(getActiveOidcOutageCircuit()).resolves.toBeNull();
  });

  it('does not delete a fenced candidate while its activation audit is committing', async () => {
    await evaluateOidcSignInDecision();
    await evaluateOidcSignInDecision();

    let resolveActivationAudit: (() => void) | undefined;
    mocks.logAuditAction
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveActivationAudit = resolve;
      }));
    mocks.findAudit
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ id: 'audit-opened' });

    const opening = evaluateOidcSignInDecision();
    await vi.waitFor(() => expect(resolveActivationAudit).toBeDefined());
    await expect(getActiveOidcOutageCircuit()).resolves.toBeNull();
    expect(values.has('auth:oidc-outage-fallback:circuit')).toBe(true);

    resolveActivationAudit?.();
    await expect(opening).resolves.toMatchObject({ kind: 'outage_fallback' });
    await expect(getActiveOidcOutageCircuit()).resolves.toMatchObject({
      correlationId: expect.any(String),
    });
  });

  it('does not return fallback if the opening lease expires during activation audit', async () => {
    await evaluateOidcSignInDecision();
    await evaluateOidcSignInDecision();

    let resolveActivationAudit: (() => void) | undefined;
    mocks.logAuditAction
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((resolve) => {
        resolveActivationAudit = resolve;
      }));
    mocks.findAudit
      .mockResolvedValueOnce(null)
      .mockResolvedValue(null);

    const opening = evaluateOidcSignInDecision();
    await vi.waitFor(() => expect(resolveActivationAudit).toBeDefined());
    values.delete('auth:oidc-outage-fallback:opening');
    await expect(getActiveOidcOutageCircuit()).resolves.toBeNull();
    expect(values.has('auth:oidc-outage-fallback:circuit')).toBe(false);

    mocks.findAudit.mockResolvedValue({ id: 'late-audit' });
    resolveActivationAudit?.();
    await expect(opening).resolves.toEqual({ kind: 'oidc_primary' });
  });

  it('never opens for TLS, HTTP, metadata, or other non-transport failures', async () => {
    mocks.probe.mockResolvedValue({
      available: false,
      reason: 'tls_failure',
      qualifiesForOutageFallback: false,
    });

    for (let attempt = 0; attempt < 4; attempt += 1) {
      await expect(evaluateOidcSignInDecision()).resolves.toEqual({ kind: 'oidc_primary' });
    }
    expect(redis.setIfAbsentWithExpiry).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('closes an open lease only after two successful recovery probes', async () => {
    await evaluateOidcSignInDecision();
    await evaluateOidcSignInDecision();
    const opened = await evaluateOidcSignInDecision();
    expect(opened.kind).toBe('outage_fallback');

    mocks.probe.mockResolvedValue({ available: true });
    await expect(evaluateOidcSignInDecision()).resolves.toMatchObject({ kind: 'outage_fallback' });
    await expect(evaluateOidcSignInDecision()).resolves.toEqual({ kind: 'oidc_primary' });
    await expect(getActiveOidcOutageCircuit()).resolves.toBeNull();
    expect(mocks.logAuditAction).toHaveBeenCalledTimes(3);
  });

  it('does not let a stale recovery probe delete a newer circuit', async () => {
    await evaluateOidcSignInDecision();
    await evaluateOidcSignInDecision();
    const opened = await evaluateOidcSignInDecision();
    expect(opened.kind).toBe('outage_fallback');

    mocks.probe.mockResolvedValue({ available: true });
    await evaluateOidcSignInDecision();

    let resolveProbe: ((value: { available: true }) => void) | undefined;
    mocks.probe.mockImplementationOnce(() => new Promise((resolve) => {
      resolveProbe = resolve;
    }));
    const staleRecovery = evaluateOidcSignInDecision();
    await vi.waitFor(() => expect(resolveProbe).toBeDefined());

    const replacement = {
      correlationId: 'outage-new',
      openedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      reason: 'connection_refused',
    };
    values.set('auth:oidc-outage-fallback:circuit', JSON.stringify(replacement));
    resolveProbe?.({ available: true });

    await expect(staleRecovery).resolves.toEqual({ kind: 'oidc_primary' });
    await expect(getActiveOidcOutageCircuit()).resolves.toMatchObject({ correlationId: 'outage-new' });
  });

  it('ignores typed start errors that are not safe downgrade evidence', async () => {
    const tlsError = new OidcProviderAvailabilityError('tls_failure', false, 'bad certificate');
    await expect(recordOidcStartFailure(tlsError)).resolves.toBeNull();
    expect(redis.incr).not.toHaveBeenCalled();
  });

  it('stays off without the explicit policy', async () => {
    process.env.AUTH_OIDC_OUTAGE_FALLBACK = 'off';
    await expect(evaluateOidcSignInDecision()).resolves.toEqual({ kind: 'oidc_primary' });
    expect(mocks.probe).not.toHaveBeenCalled();
    expect(redis.get).not.toHaveBeenCalled();
  });
});
