import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  attempts: 0,
  failOnce: false,
  isolationLevels: [] as string[],
  entries: [] as Array<Record<string, unknown>>,
}));

vi.mock('./db', () => {
  const oidcClient = {
    findUnique: async () => ({
      enabled: true,
      redirectUris: [
        'https://linked.example.test/callback',
        'https://retry.example.test/callback',
      ],
    }),
  };
  const applicationCatalogEntry = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `entry-${state.entries.length + 1}`, ...data };
      state.entries.push(row);
      return row;
    },
    findUnique: async ({ where }: { where: { id: string } }) =>
      state.entries.find((entry) => entry.id === where.id) ?? null,
    update: async ({ where, data }: {
      where: { id: string };
      data: Record<string, unknown>;
    }) => {
      const row = state.entries.find((entry) => entry.id === where.id);
      if (!row) throw new Error('not found');
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: { where: { id: string } }) => {
      const index = state.entries.findIndex((entry) => entry.id === where.id);
      if (index < 0) throw new Error('not found');
      return state.entries.splice(index, 1)[0];
    },
  };
  const auditLog = { create: async ({ data }: { data: unknown }) => data };
  return {
    prisma: {
      oidcClient,
      applicationCatalogEntry,
      auditLog,
      $transaction: async (
        work: (tx: unknown) => Promise<unknown>,
        options?: { isolationLevel?: string }
      ) => {
        state.attempts += 1;
        if (options?.isolationLevel) state.isolationLevels.push(options.isolationLevel);
        if (state.failOnce) {
          state.failOnce = false;
          throw Object.assign(new Error('write conflict'), { code: 'P2034' });
        }
        return work({ oidcClient, applicationCatalogEntry, auditLog });
      },
    },
  };
});

import { createCatalogEntry } from './application-catalog';

beforeEach(() => {
  state.attempts = 0;
  state.failOnce = false;
  state.isolationLevels = [];
  state.entries = [];
});

describe('application catalog transaction boundary', () => {
  it('publishes linked OIDC applications in a serializable transaction', async () => {
    const created = await createCatalogEntry({
      slug: 'linked-app',
      name: 'Linked app',
      description: null,
      launchUrl: 'https://linked.example.test/',
      iconUrl: null,
      kind: 'oidc',
      oidcClientId: 'linked-app',
      visibility: 'public',
      sortOrder: 0,
    }, 'admin');

    expect(created.visibility).toBe('public');
    expect(state.isolationLevels).toEqual(['Serializable']);
  });

  it('retries a PostgreSQL serialization conflict before publishing', async () => {
    state.failOnce = true;

    await expect(createCatalogEntry({
      slug: 'retry-app',
      name: 'Retry app',
      description: null,
      launchUrl: 'https://retry.example.test/',
      iconUrl: null,
      kind: 'oidc',
      oidcClientId: 'retry-app',
      visibility: 'public',
      sortOrder: 0,
    }, 'admin')).resolves.toMatchObject({ slug: 'retry-app' });

    expect(state.attempts).toBe(2);
    expect(state.isolationLevels).toEqual(['Serializable', 'Serializable']);
  });

  it('rejects a trusted OIDC catalog link on an unregistered origin', async () => {
    await expect(createCatalogEntry({
      slug: 'mismatch-app',
      name: 'Mismatched app',
      description: null,
      launchUrl: 'https://untrusted.example.test/',
      iconUrl: null,
      kind: 'oidc',
      oidcClientId: 'linked-app',
      visibility: 'public',
      sortOrder: 0,
    }, 'admin')).rejects.toThrow('launch origin must match');
    expect(state.entries).toEqual([]);
  });
});
