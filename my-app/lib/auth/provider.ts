import { prisma } from '@/lib/prisma';
import { authenticateLDAP } from '@/lib/ldap';
import { appLogger } from '@/lib/logger';
import { dummyVerifyForTiming, verifyPassword } from './password-hash';
import { localCredentialVersion } from './local-credential-version';

export type AuthProviderName = 'ad' | 'local';

type LdapAuthenticationResult = Awaited<ReturnType<typeof authenticateLDAP>>;

export type AuthenticateUserOutcome =
  | { kind: 'ad'; result: LdapAuthenticationResult }
  | { kind: 'local'; username: string; credentialVersion: string }
  | { kind: 'unavailable' };

function canonicalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

async function attemptLocalAuthentication(username: string, password: string): Promise<string | null> {
  const account = await prisma.localAccount.findFirst({
    where: { username: canonicalizeUsername(username) },
    select: { id: true, passwordHash: true, isActive: true },
  });

  if (!account) {
    await dummyVerifyForTiming();
    return null;
  }

  if (!account.isActive) {
    // Same work profile whether disabled or wrong-password so the two are
    // indistinguishable from the outside.
    await dummyVerifyForTiming();
    return null;
  }

  const passwordMatches = await verifyPassword(password, account.passwordHash);
  if (!passwordMatches) {
    return null;
  }

  await prisma.localAccount
    .update({
      where: { id: account.id },
      data: { lastUsedAt: new Date() },
    })
    .catch((error: unknown) => {
      appLogger.warn('Failed to record local account lastUsedAt', { error: String(error) });
    });
  return localCredentialVersion(account.passwordHash);
}

/** Direct Active Directory authentication. No local store is consulted. */
export async function authenticateDirectoryOnly(
  username: string,
  password: string
): Promise<AuthenticateUserOutcome> {
  return { kind: 'ad', result: await authenticateLDAP(username, password) };
}

/**
 * Portal-local authentication verifies only portal-owned break-glass rows;
 * the directory and auth-service databases are never contacted.
 */
export async function authenticateLocalOnly(
  username: string,
  password: string
): Promise<AuthenticateUserOutcome> {
  const succeeded = await attemptLocalAuthentication(username, password);
  if (succeeded) {
    return { kind: 'local', username, credentialVersion: succeeded };
  }
  return { kind: 'unavailable' };
}
