import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    systemConfigEntry: {
      findMany: mocks.findMany,
    },
  },
}));

import {
  clearConfigCache,
  getConfigValue,
  resolveAllConfig,
  resolveConfig,
} from './resolver';

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('LDAP_') || key.startsWith('SMTP_')) {
      delete process.env[key];
    }
  }
  clearConfigCache();
});

describe('resolveConfig precedence', () => {
  it('prefers the stored database row over environment and default', async () => {
    process.env.LDAP_URL = 'ldaps://env.example.test:636';
    mocks.findMany.mockResolvedValue([
      { key: 'ldap.url', value: 'ldaps://db.example.test:636' },
    ]);

    const resolved = await resolveConfig('ldap.url');
    expect(resolved.source).toBe('database');
    expect(resolved.value).toBe('ldaps://db.example.test:636');
  });

  it('falls back to the legacy environment variable when no row exists', async () => {
    process.env.LDAP_URL = 'ldaps://env.example.test:636';
    mocks.findMany.mockResolvedValue([]);

    const resolved = await resolveConfig('ldap.url');
    expect(resolved.source).toBe('environment');
    expect(resolved.value).toBe('ldaps://env.example.test:636');
  });

  it('uses safe defaults when neither source provides a value', async () => {
    delete process.env.SMTP_PORT;
    mocks.findMany.mockResolvedValue([]);

    const resolved = await resolveConfig('smtp.port');
    expect(resolved).toEqual({ key: 'smtp.port', value: 587, source: 'default' });
  });

  it('parses list values from JSON-array environment fallbacks (LDAP_ADMIN_GROUPS)', async () => {
    process.env.LDAP_ADMIN_GROUPS = '["CN=Admins,DC=example,DC=test","CN=Helpdesk,DC=example,DC=test"]';
    mocks.findMany.mockResolvedValue([]);

    const value = await getConfigValue<string[]>('ldap.adminGroups');
    expect(value).toEqual(['CN=Admins,DC=example,DC=test', 'CN=Helpdesk,DC=example,DC=test']);
  });

  it('does not replace an invalid stored value with an environment value', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SMTP_PORT = '2525';
    mocks.findMany.mockResolvedValue([{ key: 'smtp.port', value: 'not-a-number' }]);

    await expect(resolveConfig('smtp.port')).rejects.toThrow('Stored configuration key smtp.port is invalid');
    consoleError.mockRestore();
  });

  it('does not treat an unreadable store as an empty store', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.env.SMTP_HOST = 'relay.env.example.test';
    mocks.findMany.mockRejectedValue(new Error('db down'));

    await expect(resolveConfig('smtp.host')).rejects.toThrow('db down');
    consoleError.mockRestore();
  });

  it('reads persisted configuration on every resolution so replicas cannot retain stale authority data', async () => {
    mocks.findMany
      .mockResolvedValueOnce([{ key: 'ldap.adminGroups', value: ['CN=Old Admins,DC=example,DC=org'] }])
      .mockResolvedValueOnce([{ key: 'ldap.adminGroups', value: ['CN=New Admins,DC=example,DC=org'] }]);

    await expect(resolveConfig('ldap.adminGroups')).resolves.toMatchObject({
      value: ['CN=Old Admins,DC=example,DC=org'],
      source: 'database',
    });
    await expect(resolveConfig('ldap.adminGroups')).resolves.toMatchObject({
      value: ['CN=New Admins,DC=example,DC=org'],
      source: 'database',
    });
    expect(mocks.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('resolveAllConfig', () => {
  it('reports sources for every registered key in one read', async () => {
    process.env.LDAP_URL = 'ldaps://env.example.test:636';
    process.env.SMTP_PORT = '2525';
    mocks.findMany.mockResolvedValue([
      { key: 'smtp.host', value: 'relay.db.example.test' },
    ]);

    const all = await resolveAllConfig();
    const byKey = new Map(all.map((entry) => [entry.key, entry]));

    expect(byKey.get('ldap.url')).toMatchObject({ source: 'environment' });
    expect(byKey.get('smtp.port')).toMatchObject({ source: 'environment', value: 2525 });
    expect(byKey.get('smtp.host')).toMatchObject({ source: 'database', value: 'relay.db.example.test' });
    expect(byKey.get('ldap.adminGroups')).toMatchObject({ source: 'default', value: [] });
  });

  it('rejects an invalid environment fallback in bulk reads instead of displaying a false default', async () => {
    process.env.SMTP_PORT = 'not-a-number';
    mocks.findMany.mockResolvedValue([]);

    await expect(resolveAllConfig()).rejects.toThrow();
  });

  it('rejects an invalid stored value in bulk reads instead of reporting an environment fallback', async () => {
    process.env.SMTP_PORT = '2525';
    mocks.findMany.mockResolvedValue([{ key: 'smtp.port', value: 'not-a-number' }]);

    await expect(resolveAllConfig()).rejects.toThrow('Stored configuration key smtp.port is invalid');
  });
});
