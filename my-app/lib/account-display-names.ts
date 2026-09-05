import { prisma } from '@/lib/prisma';
import { resolveLDAPUserDisplayNames } from '@/lib/ldap';

// Presentation only: never use this cache for authorization or account binding.
const cache = new Map<string, { name: string | null; expires: number }>();
const normalize = (value: string) => value.trim().toLowerCase();
const MAX_NAMES = 500;
const MAX_CACHE = 2000;
type NamedAccount = { name?: string | null; displayName?: string | null; username?: string | null; ldapUsername?: string | null; linkedAdUsername?: string | null; vpnUsername?: string | null; linkedVpnUsername?: string | null };
const aliases = (row: NamedAccount) => [row.username, row.ldapUsername, row.linkedAdUsername, row.vpnUsername, row.linkedVpnUsername].filter((value): value is string => Boolean(value));

async function storedNames(usernames: string[]): Promise<NamedAccount[]> {
  const match = { in: usernames, mode: 'insensitive' as const };
  const results = await Promise.allSettled([
    prisma.accessRequest.findMany({ where: { OR: [{ ldapUsername: match }, { linkedAdUsername: match }, { vpnUsername: match }, { linkedVpnUsername: match }] }, select: { name: true, ldapUsername: true, linkedAdUsername: true, vpnUsername: true, linkedVpnUsername: true }, take: MAX_NAMES * 2 }),
    prisma.batchAccountItem.findMany({ where: { OR: [{ ldapUsername: match }, { vpnUsername: match }] }, select: { name: true, ldapUsername: true, vpnUsername: true }, take: MAX_NAMES * 2 }),
    prisma.vPNAccount.findMany({ where: { username: match }, select: { name: true, username: true }, take: MAX_NAMES }),
    prisma.directoryGroupMemberSnapshot.findMany({ where: { username: match }, select: { displayName: true, username: true }, distinct: ['username', 'displayName'], take: MAX_NAMES * 2 }),
  ]);
  const rows: NamedAccount[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      rows.push(...result.value);
    }
  }
  return rows;
}

/** Resolve only the identities already visible on the authorized page. */
export async function resolveAccountDisplayNames(values: readonly (string | null | undefined)[]): Promise<Map<string, string>> {
  const usernames = [...new Set(values.filter((value): value is string => Boolean(value?.trim())).map(normalize))].slice(0, MAX_NAMES);
  const result = new Map<string, string>();
  const missing = usernames.filter((username) => {
    const entry = cache.get(username);
    if (!entry || entry.expires < Date.now()) return true;
    if (entry.name) result.set(username, entry.name);
    return false;
  });
  if (!missing.length) return result;
  const missingSet = new Set(missing);
  const chunks = Array.from({ length: Math.ceil(missing.length / 100) }, (_, i) => missing.slice(i * 100, i * 100 + 100));
  const directory = await Promise.allSettled(chunks.map((chunk) => resolveLDAPUserDisplayNames(chunk)));
  for (const response of directory) {
    if (response.status !== 'fulfilled') continue;
    for (const [username, name] of response.value) {
      const key = normalize(username);
      if (missingSet.has(key) && name.trim() && normalize(name) !== key) result.set(key, name.trim());
    }
  }
  // A current directory object may reuse a historical username. Compare all
  // retained labels before presenting a person name on an audit/history page.
  const candidates = new Map<string, Map<string, string>>();
  for (const username of missing) {
    const liveName = result.get(username);
    if (liveName) candidates.set(username, new Map([[normalize(liveName), liveName]]));
  }
  for (const row of await storedNames(missing)) {
    const name = (row.name || row.displayName)?.trim();
    if (!name) continue;
    for (const alias of aliases(row)) {
      const key = normalize(alias);
      if (!missingSet.has(key) || normalize(name) === key) continue;
      const names = candidates.get(key) ?? new Map<string, string>();
      if (!names.has(normalize(name))) names.set(normalize(name), name);
      candidates.set(key, names);
    }
  }
  for (const [key, names] of candidates) {
    if (names.size === 1) result.set(key, [...names.values()][0]);
    else result.delete(key);
  }
  for (const username of missing) {
    cache.delete(username);
    cache.set(username, { name: result.get(username) ?? null, expires: Date.now() + (result.has(username) ? 300_000 : 30_000) });
  }
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return result;
}

/** Display-name search adds exact username matches; it never changes identifiers. */
export async function findAccountUsernamesByName(search: string): Promise<string[]> {
  const query = search.trim().slice(0, 120);
  if (query.length < 2) return [];
  const names = new Set<string>();
  for (const [username, entry] of cache) if (entry.expires > Date.now() && entry.name?.toLowerCase().includes(query.toLowerCase())) names.add(username);
  const where = { name: { contains: query, mode: 'insensitive' as const } };
  const results = await Promise.allSettled([
    prisma.accessRequest.findMany({ where, select: { ldapUsername: true, linkedAdUsername: true, vpnUsername: true, linkedVpnUsername: true }, take: 200 }),
    prisma.batchAccountItem.findMany({ where, select: { ldapUsername: true, vpnUsername: true }, take: 200 }),
    prisma.vPNAccount.findMany({ where, select: { username: true }, take: 200 }),
    prisma.directoryGroupMemberSnapshot.findMany({ where: { displayName: { contains: query, mode: 'insensitive' } }, select: { username: true }, distinct: ['username'], take: 200 }),
  ]);
  for (const result of results) if (result.status === 'fulfilled') for (const row of result.value) for (const username of aliases(row)) names.add(normalize(username));
  return [...names].slice(0, MAX_NAMES);
}
