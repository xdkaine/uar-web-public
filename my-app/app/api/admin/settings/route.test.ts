import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  systemSettingsFindFirst: vi.fn(),
  systemSettingsFindUnique: vi.fn(),
  systemSettingsCreate: vi.fn(),
  systemSettingsUpdate: vi.fn(),
  systemSettingsUpdateMany: vi.fn(),
  localAccountCount: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    systemSettings: {
      findFirst: mocks.systemSettingsFindFirst,
      findUnique: mocks.systemSettingsFindUnique,
      create: mocks.systemSettingsCreate,
      update: mocks.systemSettingsUpdate,
      updateMany: mocks.systemSettingsUpdateMany,
    },
    localAccount: {
      count: mocks.localAccountCount,
    },
  },
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditActions: {
    UPDATE_SETTINGS: 'update_settings',
  },
  AuditCategories: {
    SETTINGS: 'settings',
  },
  getIpAddress: () => '203.0.113.30',
  getUserAgent: () => 'settings-route-test',
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { GET, PATCH } from './route';

type Settings = {
  id: string;
  loginDisabled: boolean;
  internalRegistrationDisabled: boolean;
  externalRegistrationDisabled: boolean;
  globalNotificationBanner: string | null;
  notificationBannerType: string | null;
  manualOverride: boolean;
  emailFrom: string | null;
  adminEmail: string | null;
  facultyEmail: string | null;
  studentDirectorEmails: string | null;
  lastModifiedBy?: string | null;
};

function patch(body: Record<string, unknown>) {
  return new NextRequest('https://portal.example.test/api/admin/settings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('read-only system settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of ['EMAIL_FROM', 'ADMIN_EMAIL', 'FACULTY_EMAIL', 'STUDENT_DIRECTOR_EMAILS']) {
      vi.stubEnv(name, '');
    }
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'settings-reader', permissions: new Set(['settings.manage']) },
      response: null,
    });
    mocks.systemSettingsFindFirst.mockResolvedValue(null);
    mocks.systemSettingsCreate.mockResolvedValue({ id: 'unexpected-write' });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function readSettings() {
    return GET(new NextRequest('https://portal.example.test/api/admin/settings'));
  }

  it('returns truthful defaults without creating settings, even for concurrent first reads', async () => {
    const responses = await Promise.all([readSettings(), readSettings()]);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect((await response.json()).settings).toMatchObject({
        id: null, createdAt: null, updatedAt: null, lastModifiedBy: null,
        loginDisabled: false, manualOverride: false, authMode: null,
        internalRegistrationDisabled: false, externalRegistrationDisabled: false,
      });
    }
    expect(mocks.systemSettingsCreate).not.toHaveBeenCalled();
    expect(mocks.systemSettingsUpdate).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('preserves a persisted lock and metadata', async () => {
    const settings = { ...lockedSettings(), updatedAt: '2026-09-04T00:00:00.000Z' };
    mocks.systemSettingsFindFirst.mockResolvedValue(settings);
    const response = await readSettings();
    expect((await response.json()).settings).toMatchObject(settings);
    expect(mocks.systemSettingsCreate).not.toHaveBeenCalled();
  });

  it('cannot create newer defaults after a first PATCH saves a manual login lock', async () => {
    let releaseRead!: (value: null) => void;
    let readStarted!: () => void;
    const started = new Promise<void>((resolve) => { readStarted = resolve; });
    mocks.systemSettingsFindFirst.mockImplementationOnce(() => {
      readStarted();
      return new Promise<null>((resolve) => { releaseRead = resolve; });
    }).mockResolvedValue(null);
    let persisted: Record<string, unknown> | null = null;
    mocks.systemSettingsCreate.mockImplementation(async ({ data }) => {
      persisted = { ...data, id: 'first-settings' };
      return persisted;
    });
    mocks.systemSettingsUpdateMany.mockImplementation(async ({ data }) => {
      persisted = { ...persisted, ...data };
      return { count: 1 };
    });
    mocks.systemSettingsUpdate.mockImplementation(async ({ data }) => {
      persisted = { ...persisted, ...data };
      return persisted;
    });
    mocks.systemSettingsFindUnique.mockImplementation(async () => persisted);

    const delayedRead = readSettings();
    await started;
    const save = await PATCH(patch({ manualOverride: true }));
    expect(save.status).toBe(200);
    expect(persisted).toMatchObject({ manualOverride: true, loginDisabled: true });
    releaseRead(null);
    expect((await delayedRead).status).toBe(200);
    expect(mocks.systemSettingsCreate).toHaveBeenCalledTimes(1);
    expect(persisted).toMatchObject({ id: 'first-settings', manualOverride: true, loginDisabled: true });
  });

  it('retains environment fallbacks for unsaved email configuration', async () => {
    vi.stubEnv('EMAIL_FROM', 'sender@example.test');
    const response = await readSettings();
    expect((await response.json()).settings.emailFrom).toBe('sender@example.test');
  });

  it.each([null, { username: 'reader', permissions: new Set<string>() }])(
    'does not query or initialize settings for an unauthorized actor', async (admin) => {
      mocks.checkAdminAuthWithRateLimit.mockResolvedValue({ admin, response: null });
      const response = await readSettings();
      expect(response.status).toBe(admin ? 403 : 401);
      expect(mocks.systemSettingsFindFirst).not.toHaveBeenCalled();
      expect(mocks.systemSettingsCreate).not.toHaveBeenCalled();
    },
  );

  it('reports read failure without trying to initialize the database', async () => {
    mocks.systemSettingsFindFirst.mockRejectedValueOnce(new Error('database unavailable'));
    const response = await readSettings();
    expect(response.status).toBe(500);
    expect(mocks.systemSettingsCreate).not.toHaveBeenCalled();
  });
});

function lockedSettings(): Settings {
  return {
    id: 'settings-1',
    loginDisabled: true,
    internalRegistrationDisabled: false,
    externalRegistrationDisabled: false,
    globalNotificationBanner: null,
    notificationBannerType: null,
    manualOverride: true,
    emailFrom: null,
    adminEmail: null,
    facultyEmail: null,
    studentDirectorEmails: null,
  };
}

describe('manual login lock transitions', () => {
  let persistedSettings: Settings;

  beforeEach(() => {
    vi.clearAllMocks();
    persistedSettings = lockedSettings();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'security-admin', permissions: new Set(['settings.manage']) },
      response: null,
    });
    mocks.systemSettingsFindFirst.mockImplementation(async () => ({
      ...persistedSettings,
    }));
    mocks.systemSettingsUpdate.mockImplementation(async ({ data }) => {
      persistedSettings = {
        ...persistedSettings,
        ...data,
      };
      return { ...persistedSettings };
    });
    mocks.systemSettingsUpdateMany.mockImplementation(async ({ where, data }) => {
      if (where.manualOverride !== persistedSettings.manualOverride) {
        return { count: 0 };
      }

      persistedSettings = {
        ...persistedSettings,
        ...data,
      };
      return { count: 1 };
    });
    mocks.systemSettingsFindUnique.mockImplementation(async () => ({
      ...persistedSettings,
    }));
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('rejects clearing a live manual override by itself', async () => {
    const response = await PATCH(patch({ manualOverride: false }));

    expect(response.status).toBe(403);
    expect(mocks.systemSettingsUpdate).not.toHaveBeenCalled();
    expect(persistedSettings).toMatchObject({
      loginDisabled: true,
      manualOverride: true,
    });
  });

  it('rejects clearing the override and enabling logins together', async () => {
    const response = await PATCH(patch({
      loginDisabled: false,
      manualOverride: false,
    }));

    expect(response.status).toBe(403);
    expect(mocks.systemSettingsUpdate).not.toHaveBeenCalled();
  });

  it('blocks the two-request API unlock sequence', async () => {
    const clearOverride = await PATCH(patch({ manualOverride: false }));
    const enableLogins = await PATCH(patch({ loginDisabled: false }));

    expect(clearOverride.status).toBe(403);
    expect(enableLogins.status).toBe(403);
    expect(mocks.systemSettingsUpdate).not.toHaveBeenCalled();
    expect(persistedSettings).toMatchObject({
      loginDisabled: true,
      manualOverride: true,
    });
  });

  it('allows normal administration after an out-of-band unlock', async () => {
    persistedSettings.manualOverride = false;
    persistedSettings.lastModifiedBy = 'break-glass:recovery-operator:SEC-123';

    const response = await PATCH(patch({ loginDisabled: false }));

    expect(response.status).toBe(200);
    expect(mocks.systemSettingsUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'settings-1',
        manualOverride: false,
      },
      data: {
        lastModifiedBy: 'security-admin',
        loginDisabled: false,
      },
    });
    expect(persistedSettings.loginDisabled).toBe(false);
  });

  it('requires a different authenticated administrator to complete break-glass recovery', async () => {
    persistedSettings.manualOverride = false;
    persistedSettings.lastModifiedBy = 'break-glass:security-admin:SEC-123';

    const response = await PATCH(patch({ loginDisabled: false }));

    expect(response.status).toBe(403);
    expect(mocks.systemSettingsUpdateMany).not.toHaveBeenCalled();
    expect(persistedSettings.loginDisabled).toBe(true);
  });

  it('makes activating the manual override disable logins atomically', async () => {
    persistedSettings = {
      ...persistedSettings,
      loginDisabled: false,
      manualOverride: false,
    };

    const response = await PATCH(patch({ manualOverride: true }));

    expect(response.status).toBe(200);
    expect(mocks.systemSettingsUpdate).toHaveBeenCalledWith({
      where: { id: 'settings-1' },
      data: {
        lastModifiedBy: 'security-admin',
        loginDisabled: true,
        manualOverride: true,
      },
    });
    expect(persistedSettings).toMatchObject({
      loginDisabled: true,
      manualOverride: true,
    });
  });

  it('cannot re-enable logins with a stale write racing lock activation', async () => {
    persistedSettings = {
      ...persistedSettings,
      loginDisabled: false,
      manualOverride: false,
    };

    let releaseEnableWrite!: () => void;
    let enableWriteReached!: () => void;
    const enableWritePaused = new Promise<void>((resolve) => {
      releaseEnableWrite = resolve;
    });
    const atEnableWrite = new Promise<void>((resolve) => {
      enableWriteReached = resolve;
    });

    mocks.systemSettingsUpdateMany.mockImplementationOnce(async ({ where, data }) => {
      enableWriteReached();
      await enableWritePaused;
      if (where.manualOverride !== persistedSettings.manualOverride) {
        return { count: 0 };
      }

      persistedSettings = {
        ...persistedSettings,
        ...data,
      };
      return { count: 1 };
    });

    const staleEnable = PATCH(patch({ loginDisabled: false }));
    await atEnableWrite;

    const activateLock = await PATCH(patch({ manualOverride: true }));
    releaseEnableWrite();
    const enableResponse = await staleEnable;

    expect(activateLock.status).toBe(200);
    expect(enableResponse.status).toBe(403);
    expect(persistedSettings).toMatchObject({
      loginDisabled: true,
      manualOverride: true,
    });
  });
});

describe('auth mode write validation', () => {
  const originalEnv = { ...process.env };
  let persistedSettings: Settings;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_MODE = 'native';
    delete process.env.AUTH_ISSUER;
    delete process.env.AUTH_CLIENT_SECRET;
    process.env.LDAP_URL = 'ldaps://directory.example.test:636';

    persistedSettings = { ...lockedSettings(), loginDisabled: false, manualOverride: false };
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'security-admin', permissions: new Set(['settings.manage']) },
      response: null,
    });
    mocks.systemSettingsFindFirst.mockResolvedValue({ ...persistedSettings });
    mocks.systemSettingsUpdate.mockImplementation(async ({ data }) => {
      persistedSettings = { ...persistedSettings, ...data };
      return { ...persistedSettings };
    });
    mocks.systemSettingsUpdateMany.mockResolvedValue({ count: 1 });
    mocks.systemSettingsFindUnique.mockResolvedValue({ ...persistedSettings });
    mocks.localAccountCount.mockResolvedValue(1);
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('rejects sign-in modes outside the allowed enum with a clear error', async () => {
    const response = await PATCH(patch({ authMode: 'saml' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'authMode must be one of: oidc, native, local (or null to clear the override)',
    });
    expect(mocks.systemSettingsUpdate).not.toHaveBeenCalled();
    expect(mocks.systemSettingsUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects non-string authMode values', async () => {
    const response = await PATCH(patch({ authMode: 42 }));

    expect(response.status).toBe(400);
    expect(mocks.systemSettingsUpdateMany).not.toHaveBeenCalled();
  });

  it('persists null authMode to clear the override and fall back to configuration', async () => {
    const response = await PATCH(patch({ authMode: null }));

    expect(response.status).toBe(200);
    expect(mocks.systemSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authMode: null }),
      })
    );
  });

  it('rejects oidc mode when the issuer or client secret is not configured', async () => {
    const response = await PATCH(patch({ authMode: 'oidc' }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('AUTH_ISSUER');
    expect(mocks.systemSettingsUpdateMany).not.toHaveBeenCalled();
  });

  it('accepts oidc mode once issuer and client secret are configured', async () => {
    process.env.AUTH_ISSUER = 'https://auth.example.test';
    process.env.AUTH_CLIENT_ID = 'uar-portal';
    process.env.AUTH_CLIENT_SECRET = 'shared-secret-value';
    process.env.AUTH_REDIRECT_URI = 'https://portal.example.test/api/auth/oidc/callback';

    const response = await PATCH(patch({ authMode: 'oidc' }));

    expect(response.status).toBe(200);
    expect(mocks.systemSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authMode: 'oidc' }),
      })
    );
  });

  it('rejects local-only mode when no active break-glass account exists', async () => {
    mocks.localAccountCount.mockResolvedValue(0);

    const response = await PATCH(patch({ authMode: 'local' }));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('break-glass account');
    expect(mocks.systemSettingsUpdateMany).not.toHaveBeenCalled();
  });

  it('accepts local-only mode when an active break-glass account exists', async () => {
    const response = await PATCH(patch({ authMode: 'local' }));

    expect(response.status).toBe(200);
    expect(mocks.localAccountCount).toHaveBeenCalledWith({ where: { isActive: true } });
    expect(mocks.systemSettingsUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ authMode: 'local' }),
      })
    );
  });

  it('rejects native mode without directory access or any break-glass account', async () => {
    mocks.localAccountCount.mockResolvedValue(0);
    delete process.env.LDAP_URL;

    const response = await PATCH(patch({ authMode: 'native' }));

    expect(response.status).toBe(400);
    expect(mocks.systemSettingsUpdateMany).not.toHaveBeenCalled();
  });
});
