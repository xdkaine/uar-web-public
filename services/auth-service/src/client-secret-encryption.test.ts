import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_SECRET_ENC_KEY_ENV,
  decryptClientSecret,
  encryptClientSecret,
  isEncryptedClientSecret,
} from './secret-encryption';
import {
  assertClientSecretsDecryptable,
  createOidcClient,
  getOidcClientRow,
  listOidcClients,
  providerClientAdapter,
  reencryptPlaintextSecretsOnBoot,
  rotateOidcClientSecret,
  syncAllClientsOnBoot,
} from './oidc-clients';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

interface StoredRow {
  id: string;
  clientId: string;
  name: string;
  secret: string;
  redirectUris: string[];
  scope: string;
  enabled: boolean;
  sessionTtlSeconds: number | null;
  createdBy: string;
}

const dbState: { rows: StoredRow[]; seq: number } = { rows: [], seq: 0 };

vi.mock('./db', () => {
  const oidcClient = {
      findMany: async () => dbState.rows.map((row) => ({ ...row })),
      findUnique: async ({ where }: { where: { clientId: string } }) =>
        dbState.rows.find((row) => row.clientId === where.clientId) ?? null,
      create: async ({ data }: { data: Omit<StoredRow, 'id'> }) => {
        const row: StoredRow = { id: `row-${(dbState.seq += 1)}`, ...data };
        dbState.rows.push(row);
        return { ...row };
      },
      update: async ({
        where,
        data,
      }: {
        where: { clientId: string };
        data: Partial<StoredRow>;
      }) => {
        const row = dbState.rows.find((entry) => entry.clientId === where.clientId);
        if (!row) throw new Error('Record not found');
        Object.assign(row, data);
        return { ...row };
      },
  };
  const auditLog = { create: async ({ data }: { data: unknown }) => data };
  const applicationCatalogEntry = { updateMany: async () => ({ count: 0 }) };
  return {
    withSessionAdvisoryLock: async (_key: string, work: () => Promise<unknown>) => work(),
    prisma: {
      oidcClient,
      auditLog,
      applicationCatalogEntry,
      $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
        work({ oidcClient, auditLog, applicationCatalogEntry }),
    },
  };
});

function storedRow(clientId: string, secret: string): void {
  dbState.rows.push({
    id: `row-${(dbState.seq += 1)}`,
    clientId,
    name: clientId,
    secret,
    redirectUris: [`https://${clientId}.example.test/callback`],
    scope: 'openid email profile amr',
    enabled: true,
    sessionTtlSeconds: null,
    createdBy: 'test',
  });
}

function spyMirror() {
  const synced: Array<Record<string, unknown>> = [];
  const adapter = {
    async upsert(_id: string, payload: Record<string, unknown>) {
      synced.push(payload);
    },
    async destroy(_id: string) {},
  };
  return { adapter, synced };
}

beforeEach(() => {
  dbState.rows = [];
  dbState.seq = 0;
  process.env[CLIENT_SECRET_ENC_KEY_ENV] = KEY_A;
});

afterEach(() => {
  delete process.env[CLIENT_SECRET_ENC_KEY_ENV];
});

describe('envelope encryption primitives', () => {
  it('round-trips a secret through a versioned GCM envelope', () => {
    const envelope = encryptClientSecret('raw-provider-secret');
    expect(isEncryptedClientSecret(envelope)).toBe(true);
    expect(envelope.startsWith('v1:')).toBe(true);
    expect(decryptClientSecret(envelope)).toBe('raw-provider-secret');
    // Unique IV per record: identical plaintext never yields equal envelopes.
    expect(encryptClientSecret('raw-provider-secret')).not.toBe(envelope);
    expect(envelope).not.toContain('raw');
  });

  it('rejects a wrong key and leaves the ciphertext unchanged', () => {
    const envelope = encryptClientSecret('raw-provider-secret');
    process.env[CLIENT_SECRET_ENC_KEY_ENV] = KEY_B;
    expect(decryptClientSecret(envelope)).toBeNull();
    expect(isEncryptedClientSecret(envelope)).toBe(true);
    expect(decryptClientSecret(`${envelope}00`)).toBeNull();
  });

  it('fails closed without a configured key', () => {
    delete process.env[CLIENT_SECRET_ENC_KEY_ENV];
    expect(() => encryptClientSecret('raw')).toThrow(new RegExp(CLIENT_SECRET_ENC_KEY_ENV));
    const envelope = `${'a'.repeat(64)}:${'b'.repeat(64)}`;
    expect(decryptClientSecret(`v1:${envelope}:abcd`)).toBeNull();
    expect(isEncryptedClientSecret('plain-legacy-secret')).toBe(false);
  });
});

describe('registry secret flows', () => {
  it('create stores ciphertext while the Redis mirror receives the RAW secret', async () => {
    const { adapter, synced } = spyMirror();
    const mirror = providerClientAdapter(adapter);

    const created = await createOidcClient(
      { name: 'Acme App', redirectUris: ['https://acme.example.test/callback'], createdBy: 'tester' },
      mirror
    );

    const stored = dbState.rows.find((row) => row.clientId === created.row.clientId);
    expect(stored).toBeDefined();
    expect(isEncryptedClientSecret(String(stored?.secret))).toBe(true);
    expect(stored?.secret).not.toBe(created.clientSecret);
    expect(decryptClientSecret(String(stored?.secret))).toBe(created.clientSecret);

    expect(synced).toHaveLength(1);
    expect(synced[0].client_secret).toBe(created.clientSecret);

    // Show-once semantics: the returned row never carries secret material.
    expect(created.row.hasSecret).toBe(true);
    expect(JSON.stringify(created.row)).not.toContain('"secret"');
    expect(JSON.stringify(created.row)).not.toContain(created.clientSecret);
  });

  it('lazily re-encrypts a legacy plaintext row on read touch', async () => {
    storedRow('legacy-app', 'legacy-plaintext-value');

    const row = await getOidcClientRow('legacy-app');

    expect(row?.secret).toBe('legacy-plaintext-value');
    const stored = dbState.rows.find((entry) => entry.clientId === 'legacy-app');
    expect(isEncryptedClientSecret(String(stored?.secret))).toBe(true);
    expect(decryptClientSecret(String(stored?.secret))).toBe('legacy-plaintext-value');

    // Second touch finds an already-encrypted row and still resolves raw.
    const again = await getOidcClientRow('legacy-app');
    expect(again?.secret).toBe('legacy-plaintext-value');
  });

  it('boot sync re-encrypts legacy rows and mirrors raw values', async () => {
    storedRow('boot-app', 'boot-plaintext');
    const { adapter, synced } = spyMirror();

    const count = await syncAllClientsOnBoot(providerClientAdapter(adapter));

    expect(count).toBe(1);
    expect(synced[0].client_secret).toBe('boot-plaintext');
    const stored = dbState.rows.find((entry) => entry.clientId === 'boot-app');
    expect(isEncryptedClientSecret(String(stored?.secret))).toBe(true);
  });

  it('refuses to boot while ciphertext exists without a usable key', async () => {
    storedRow('locked-app', encryptClientSecret('encrypted-value'));
    delete process.env[CLIENT_SECRET_ENC_KEY_ENV];

    await expect(assertClientSecretsDecryptable()).rejects.toThrow(
      new RegExp(CLIENT_SECRET_ENC_KEY_ENV)
    );

    process.env[CLIENT_SECRET_ENC_KEY_ENV] = KEY_A;
    await expect(assertClientSecretsDecryptable()).resolves.toBeUndefined();
    process.env[CLIENT_SECRET_ENC_KEY_ENV] = KEY_B;
    await expect(assertClientSecretsDecryptable()).rejects.toThrow(
      new RegExp(CLIENT_SECRET_ENC_KEY_ENV)
    );
  });

  it('re-encrypts plaintext rows at boot and logs only a count', async () => {
    storedRow('boot-legacy-1', 'first-plaintext');
    storedRow('boot-legacy-2', 'second-plaintext');
    storedRow('boot-cipher', encryptClientSecret('already-encrypted'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await expect(reencryptPlaintextSecretsOnBoot()).resolves.toBeUndefined();

    // Both legacy rows are now envelope ciphertext that decrypts to the
    // original values; the already-encrypted row is untouched.
    for (const [clientId, expected] of [
      ['boot-legacy-1', 'first-plaintext'],
      ['boot-legacy-2', 'second-plaintext'],
    ] as const) {
      const stored = dbState.rows.find((entry) => entry.clientId === clientId);
      expect(isEncryptedClientSecret(String(stored?.secret))).toBe(true);
      expect(decryptClientSecret(String(stored?.secret))).toBe(expected);
    }
    const untouched = dbState.rows.find((entry) => entry.clientId === 'boot-cipher');
    expect(decryptClientSecret(String(untouched?.secret))).toBe('already-encrypted');

    // Exactly one summary line: a COUNT only, never secret material.
    const logged = logSpy.mock.calls.map((args) => args.join(' ')).join('\n');
    expect(logged).toContain('re-encrypted 2 plaintext client secret(s)');
    for (const secret of ['first-plaintext', 'second-plaintext']) {
      expect(logged).not.toContain(secret);
    }
    logSpy.mockRestore();
  });

  it('skips boot re-encryption entirely when no key is configured', async () => {
    storedRow('no-key-app', 'stays-plaintext');
    delete process.env[CLIENT_SECRET_ENC_KEY_ENV];

    await reencryptPlaintextSecretsOnBoot();

    const stored = dbState.rows.find((entry) => entry.clientId === 'no-key-app');
    expect(stored?.secret).toBe('stays-plaintext');
  });

  it('rotates into fresh ciphertext, mirrors raw, keeps show-once output', async () => {
    storedRow('rotate-app', encryptClientSecret('old-secret'));
    const { adapter, synced } = spyMirror();
    const before = dbState.rows.find((entry) => entry.clientId === 'rotate-app')?.secret;

    const rotated = await rotateOidcClientSecret('rotate-app', providerClientAdapter(adapter));

    expect(rotated?.clientSecret).toBeTruthy();
    const stored = dbState.rows.find((entry) => entry.clientId === 'rotate-app');
    expect(stored?.secret).not.toBe(before);
    expect(isEncryptedClientSecret(String(stored?.secret))).toBe(true);
    expect(decryptClientSecret(String(stored?.secret))).toBe(rotated?.clientSecret);
    expect(synced[0].client_secret).toBe(rotated?.clientSecret);
    expect(JSON.stringify(rotated)).not.toContain('"secret":{');
  });

  it('listings expose hasSecret and never secret material', async () => {
    storedRow('listed-app', encryptClientSecret('hidden-value'));

    const clients = await listOidcClients();

    expect(clients).toHaveLength(1);
    expect(clients[0].hasSecret).toBe(true);
    const serialized = JSON.stringify(clients);
    expect(serialized).not.toContain('hidden-value');
    expect(serialized).not.toContain('"secret"');
  });
});
