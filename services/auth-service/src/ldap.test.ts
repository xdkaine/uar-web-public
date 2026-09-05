import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthConfig } from './config';
import { authenticateAd, changeAdPasswordWithCurrent, loadAdGroupMembership } from './ldap';

const harness = vi.hoisted(() => {
  return {
    clients: [] as Array<Record<string, unknown> | undefined>,
    bindImpl:
      undefined as undefined | ((upn: string, password: string) => Promise<void>),
    searchImpl:
      undefined as
        | undefined
        | ((
            base: string,
            options: { scope?: string; filter?: string; attributes?: string[]; sizeLimit?: number }
          ) => Promise<{ searchEntries: Array<Record<string, unknown>> }>),
    modifyImpl: undefined as undefined | ((dn: string, changes: unknown[]) => Promise<void>),
    tlsConnectCalls: [] as Array<Record<string, unknown> | undefined>,
    tlsOutcome: 'error' as 'secureConnect' | 'error' | 'timeout',
  };
});

vi.mock('ldapts', () => {
  class Attribute {
    type: string;
    values: unknown[];
    constructor(input: { type: string; values: unknown[] }) {
      this.type = input.type;
      this.values = input.values;
    }
  }
  class Change {
    operation: string;
    modification: Attribute;
    constructor(input: { operation: string; modification: Attribute }) {
      this.operation = input.operation;
      this.modification = input.modification;
    }
  }
  class Client {
    readonly options: unknown;
    constructor(options: unknown) {
      this.options = options;
      harness.clients.push(options as Record<string, unknown>);
    }
    async bind(upn: string, password: string): Promise<void> {
      if (!harness.bindImpl) throw new Error('no bind script configured');
      await harness.bindImpl(upn, password);
    }
    async search(
      base: string,
      options: { scope?: string; filter?: string; attributes?: string[]; sizeLimit?: number }
    ): Promise<{ searchEntries: Array<Record<string, unknown>> }> {
      if (!harness.searchImpl) throw new Error('no search script configured');
      return harness.searchImpl(base, options);
    }
    async modify(dn: string, changes: unknown[]): Promise<void> {
      if (!harness.modifyImpl) throw new Error('no modify script configured');
      await harness.modifyImpl(dn, changes);
    }
    async unbind(): Promise<void> {}
  }
  return { Attribute, Change, Client };
});

vi.mock('tls', () => {
  const connect = (options: Record<string, unknown>): unknown => {
    harness.tlsConnectCalls.push(options);
    const listeners = new Map<string, Array<() => void>>();
    const socket = {
      once(event: string, cb: () => void): void {
        const bucket = listeners.get(event) ?? [];
        bucket.push(cb);
        listeners.set(event, bucket);
      },
      destroy(): void {},
      fire(event: string): void {
        for (const cb of listeners.get(event) ?? []) cb();
      },
    };
    queueMicrotask(() => socket.fire(harness.tlsOutcome));
    return socket;
  };
  return { connect, default: { connect } };
});

function config(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    issuer: 'http://localhost:4003',
    port: 3003,
    databaseUrl: 'postgres://x',
    redisUrl: 'redis://x',
    cookieKeys: ['k'],
    clientId: 'uar-portal',
    clientSecret: 's',
    redirectUris: [],
    postLogoutRedirects: [],
    ldapDomain: 'ad.example.test',
    ldapUrl: 'ldaps://dc01.ad.example.test:636',
    ldapSearchBase: 'DC=ad,DC=example,DC=test',
    ldapBindDn: '',
    ldapBindPassword: '',
    allowInvalidCertificates: false,
    turnstileSiteKey: 'site',
    turnstileSecretKey: 'secret',
    loginWindowMs: 900000,
    loginMaxAttempts: 20,
    accountLockWindowMs: 900000,
    accountLockMaxAttempts: 5,
    internalBrandingToken: '',
    adminUsernames: [],
    adminGroups: [],
    ...overrides,
  } as AuthConfig;
}

/** Verbatim-shaped AD AcceptSecurityContext rejection carrying a sub-error code. */
function adError(dataCode: string): Error {
  return new Error(
    `80090308: LdapErr: DSID-0C090447, comment: AcceptSecurityContext error, data ${dataCode}, v3839`
  );
}

const utf16leQuoted = (value: string): Buffer =>
  Buffer.from(`"${value}"`, 'utf16le');

beforeEach(() => {
  harness.clients.length = 0;
  harness.tlsConnectCalls.length = 0;
  harness.tlsOutcome = 'error';
  harness.bindImpl = async () => {};
  harness.searchImpl = async () => ({ searchEntries: [] });
  harness.modifyImpl = async () => {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('authenticateAd', () => {
  it('binds AS the constructed UPN and always unbinds the client', async () => {
    const boundUpns: string[] = [];
    harness.bindImpl = async (upn) => {
      boundUpns.push(upn);
    };
    const result = await authenticateAd(config(), 'alice', 'secret-pw');
    expect(result).toEqual({ success: true, status: 'authenticated' });
    expect(boundUpns).toEqual(['alice@ad.example.test']);
    expect(harness.clients).toHaveLength(1);
    expect(harness.clients[0]).toEqual({
      url: 'ldaps://dc01.ad.example.test:636',
      tlsOptions: { rejectUnauthorized: true },
    });
  });

  it('passes an already-UPN username through unchanged', async () => {
    const boundUpns: string[] = [];
    harness.bindImpl = async (upn) => {
      boundUpns.push(upn);
    };
    await authenticateAd(config(), 'Alice@Other.Example.COM', 'secret-pw');
    expect(boundUpns).toEqual(['Alice@Other.Example.COM']);
  });

  it('rejects empty credentials before constructing any client', async () => {
    expect(await authenticateAd(config(), '', 'pw')).toEqual({
      success: false,
      status: 'invalid_credentials',
      error: 'Username and password are required',
    });
    expect(await authenticateAd(config(), 'alice', '')).toMatchObject({
      status: 'invalid_credentials',
    });
    expect(harness.clients).toHaveLength(0);
  });

  it.each([
    ['52e', 'invalid_credentials', 'Invalid credentials'],
    ['532', 'password_expired', 'Password expired'],
    ['533', 'account_disabled', 'Account disabled'],
    ['775', 'account_locked', 'Account locked'],
    ['701', 'account_expired', 'Account expired'],
    ['531', 'account_restricted', 'Account logon restricted'],
    ['773', 'password_change_required', 'Password change required'],
  ])('classifies AD sub-error %s as %s', async (code, expectedStatus, expectedError) => {
    harness.bindImpl = async () => {
      throw adError(code);
    };
    expect(await authenticateAd(config(), 'alice', 'bad')).toEqual({
      success: false,
      status: expectedStatus,
      error: expectedError,
    });
  });

  it('maps bind timeouts to transport-level timeout without probing reachability', async () => {
    harness.bindImpl = async () => {
      throw new Error('15000ms timed out');
    };
    expect(await authenticateAd(config(), 'alice', 'pw')).toEqual({
      success: false,
      status: 'timeout',
      error: 'LDAP authentication timeout',
    });
    expect(harness.tlsConnectCalls).toHaveLength(0);
  });

  it('treats unknown errors on an unreachable directory as transport timeout', async () => {
    harness.bindImpl = async () => {
      throw new Error('connection reset by peer');
    };
    // tls mock default outcome is 'error' (unreachable).
    expect(await authenticateAd(config(), 'alice', 'pw')).toEqual({
      success: false,
      status: 'timeout',
      error: 'Directory unreachable',
    });
    expect(harness.tlsConnectCalls[0]).toMatchObject({
      host: 'dc01.ad.example.test',
      port: 636,
      rejectUnauthorized: true,
    });
  });

  it('reports unknown_error only when the directory is actually reachable', async () => {
    harness.tlsOutcome = 'secureConnect';
    harness.bindImpl = async () => {
      throw new Error('serverDownResult');
    };
    const result = await authenticateAd(config(), 'alice', 'pw');
    expect(result.status).toBe('unknown_error');
    expect(result.success).toBe(false);
  });

  it('honors the lab-only certificate verification escape hatch', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const result = await authenticateAd(config({ allowInvalidCertificates: true }), 'alice', 'pw');
      expect(result.success).toBe(true);
      expect(harness.clients[0]).toMatchObject({
        tlsOptions: { rejectUnauthorized: false },
      });
      // The dangerous configuration must be loud.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('certificate verification is DISABLED'));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('survives non-Error rejections from the directory client', async () => {
    harness.bindImpl = async () => {
      throw 'string-fault';
    };
    const result = await authenticateAd(config(), 'alice', 'pw');
    expect(['timeout', 'unknown_error']).toContain(result.status);
  });
});

describe('changeAdPasswordWithCurrent', () => {
  function scriptHappyChange(): {
    modifies: Array<{ dn: string; changes: unknown[] }>;
  } {
    const modifies: Array<{ dn: string; changes: unknown[] }> = [];
    harness.searchImpl = async (base) => {
      if (base === '') {
        return { searchEntries: [{ defaultNamingContext: 'DC=ad,DC=example,DC=test' }] };
      }
      return { searchEntries: [{ dn: 'CN=Alice,DC=ad,DC=example,DC=test' }] };
    };
    harness.modifyImpl = async (dn, changes) => {
      modifies.push({ dn, changes });
    };
    return { modifies };
  }

  it('performs delete+add on unicodePwd after resolving the DN via rootDSE', async () => {
    const searches: Record<string, { base: string; options: Record<string, unknown> }> = {};
    const { modifies } = scriptHappyChange();
    const originalSearch = harness.searchImpl;
    harness.searchImpl = async (base, options) => {
      searches[base === '' ? 'rootDSE' : 'user'] = { base, options };
      return originalSearch(base, options);
    };

    const result = await changeAdPasswordWithCurrent(
      config(),
      'alice',
      'current-pass',
      'new-pass-123'
    );

    expect(result).toEqual({ ok: true });
    expect(searches.rootDSE?.base).toBe('');
    expect(searches.rootDSE?.options).toMatchObject({
      scope: 'base',
      attributes: ['defaultNamingContext'],
    });
    expect(searches.user?.base).toBe('DC=ad,DC=example,DC=test');
    expect(searches.user?.options).toMatchObject({
      scope: 'sub',
      filter: '(sAMAccountName=alice)',
      sizeLimit: 1,
    });
    expect(modifies).toHaveLength(1);
    expect(modifies[0]?.dn).toBe('CN=Alice,DC=ad,DC=example,DC=test');
    const [remove, add] = modifies[0]?.changes ?? [];
    expect((remove as { operation: string }).operation).toBe('delete');
    expect((add as { operation: string }).operation).toBe('add');
    for (const change of modifies[0]?.changes ?? []) {
      expect((change as { modification: { type: string } }).modification.type).toBe('unicodePwd');
    }
    expect((remove as { modification: { values: Buffer[] } }).modification.values[0].equals(utf16leQuoted('current-pass'))).toBe(true);
    expect((add as { modification: { values: Buffer[] } }).modification.values[0].equals(utf16leQuoted('new-pass-123'))).toBe(true);
  });

  it('strips filter metacharacters from the submitted username', async () => {
    const filters: string[] = [];
    harness.searchImpl = async (base, options) => {
      if (base === '') {
        return { searchEntries: [{ defaultNamingContext: 'DC=ad,DC=example,DC=test' }] };
      }
      filters.push(String(options.filter));
      return { searchEntries: [{ dn: 'CN=x' }] };
    };

    await changeAdPasswordWithCurrent(config(), 'a.l*i(c)e)*x', 'cur', 'new-pass-123');

    expect(filters).toEqual(['(sAMAccountName=a.licex)']);
  });

  it('rejects a wrong current password as a credential failure', async () => {
    harness.bindImpl = async (_upn, password) => {
      if (password !== 'right-current') throw adError('52e');
    };
    const failed = await changeAdPasswordWithCurrent(config(), 'alice', 'wrong-current', 'new-pass-123');
    expect(failed).toEqual({
      ok: false,
      error: 'Current password was not accepted by Active Directory.',
    });
    // Bind-stage failures of ANY shape are credential failures.
    harness.bindImpl = async () => {
      throw new Error('connect refused');
    };
    const bindStage = await changeAdPasswordWithCurrent(config(), 'alice', 'x', 'new-pass-123');
    expect(bindStage.error).toBe('Current password was not accepted by Active Directory.');
  });

  it('fails closed when the naming context cannot be resolved', async () => {
    harness.searchImpl = async () => ({ searchEntries: [] });
    const result = await changeAdPasswordWithCurrent(config(), 'alice', 'current', 'new-pass-123');
    expect(result).toEqual({ ok: false, error: 'Could not resolve directory naming context' });
  });

  it('fails closed when the user entry is not found in the directory', async () => {
    harness.searchImpl = async (base) =>
      base === ''
        ? { searchEntries: [{ defaultNamingContext: 'DC=ad,DC=example,DC=test' }] }
        : { searchEntries: [] };
    const result = await changeAdPasswordWithCurrent(config(), 'alice', 'current', 'new-pass-123');
    expect(result).toEqual({ ok: false, error: 'User not found in directory' });
  });

  function scriptModifyReachable(): void {
    harness.searchImpl = async (base) =>
      base === ''
        ? { searchEntries: [{ defaultNamingContext: 'DC=ad,DC=example,DC=test' }] }
        : { searchEntries: [{ dn: 'CN=Alice' }] };
  }

  const COMPLEXITY_MESSAGE =
    'Active Directory rejected the new password. It may not meet complexity requirements or may match a previous password.';

  it.each([
    ['numeric code 19', () => Object.assign(new Error('modify failed'), { code: 19 })],
    ['numeric code 53', () => Object.assign(new Error('modify failed'), { code: 53 })],
    ['WILL_NOT_PERFORM marker', () => new Error('unwillingToPerform: WILL_NOT_PERFORM')],
    ['constraint-violation marker', () => new Error('constraint violation')],
  ])('maps AD policy rejections (%s) to the complexity message', async (_label, thrower) => {
    scriptModifyReachable();
    harness.modifyImpl = async () => {
      throw thrower();
    };
    const result = await changeAdPasswordWithCurrent(config(), 'alice', 'current', 'weak');
    expect(result.ok).toBe(false);
    expect(result.error).toBe(COMPLEXITY_MESSAGE);
  });

  it('surfaces unexpected modify failures generically to users while preserving audit detail', async () => {
    harness.searchImpl = async (base) =>
      base === ''
        ? { searchEntries: [{ defaultNamingContext: 'DC=ad,DC=example,DC=test' }] }
        : { searchEntries: [{ dn: 'CN=Alice' }] };
    harness.modifyImpl = async () => {
      throw new Error('disk full');
    };
    const result = await changeAdPasswordWithCurrent(config(), 'alice', 'current', 'new-pass-123');
    // The user-facing error is generic; the raw directory message rides in
    // `detail` for server-side audit logging only.
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Unable to complete password change. Contact your administrator.');
    expect(result.detail).toBe('disk full');
  });
});

describe('loadAdGroupMembership', () => {
  it('reads memberOf arrays from the user entry under the search base', async () => {
    harness.searchImpl = async (base, options) => {
      expect(base).toBe('DC=ad,DC=example,DC=test');
      expect(options.attributes).toEqual(['memberOf']);
      return { searchEntries: [{ memberOf: ['CN=Admins,DC=ad', 'CN=Users,DC=ad'] }] };
    };
    const result = await loadAdGroupMembership(config(), 'alice', 'pw');
    expect(result).toEqual({ ok: true, memberOf: ['CN=Admins,DC=ad', 'CN=Users,DC=ad'] });
  });

  it('wraps single-valued memberOf strings into an array', async () => {
    harness.searchImpl = async () => ({ searchEntries: [{ memberOf: 'CN=Solo,DC=ad' }] });
    const result = await loadAdGroupMembership(config(), 'bob', 'pw');
    expect(result).toEqual({ ok: true, memberOf: ['CN=Solo,DC=ad'] });
  });

  it('returns an empty list when the entry has no memberOf', async () => {
    harness.searchImpl = async () => ({ searchEntries: [{ dn: 'CN=Bare' }] });
    const result = await loadAdGroupMembership(config(), 'bob', 'pw');
    expect(result).toEqual({ ok: true, memberOf: [] });
  });

  it('strips LDAP filter metacharacters from the probed username', async () => {
    const seen: string[] = [];
    harness.searchImpl = async (_base, options) => {
      seen.push(String(options.filter));
      return { searchEntries: [] };
    };
    await loadAdGroupMembership(config(), 'al*i(ce)\\x', 'pw');
    expect(seen).toEqual(['(sAMAccountName=alicex)']);
  });

  it.each([
    ['invalid credentials', 'invalid'],
    [adError('532').message, 'invalid'],
    [adError('773').message, 'invalid'],
    [adError('775').message, 'invalid'],
    ['connection reset by peer', 'timeout'],
  ])('classifies probe failures %s -> %s', async (message, reason) => {
    harness.bindImpl = async () => {
      throw new Error(message);
    };
    const result = await loadAdGroupMembership(config(), 'alice', 'pw');
    expect(result).toEqual({ ok: false, reason });
  });
});
