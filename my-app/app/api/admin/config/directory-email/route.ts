import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { emitAuditActionLog, logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { actorHasPermission } from '@/lib/rbac/core';
import { clearConfigCache, resolveAllConfig, resolveSecret } from '@/lib/config/resolver';
import { getConfigDefinition, getSecretDefinition, isKnownConfigKey, SECRET_CONFIG_REGISTRY } from '@/lib/config/registry';
import { normalizeRevisionReason, SECRET_REVISION_MARKER } from '@/lib/config/revisions';
import { decryptPassword, encryptPassword } from '@/lib/encryption';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { SIGN_IN_POLICY_KEY, validatePortalSignInPolicy } from '@/lib/auth/sign-in-policy';
import { getOidcSignInMethods } from '@/lib/auth/alternate-signin';

export const dynamic = 'force-dynamic';

function isDirectoryEmailConfigKey(key: string): boolean {
  return key.startsWith('ldap.') || key.startsWith('smtp.') || key.startsWith('email.');
}

export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'directory.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [entries, secretStates] = await Promise.all([
    resolveAllConfig(),
    Promise.all(
      Object.values(SECRET_CONFIG_REGISTRY).map(async (definition) => {
        const resolved = await resolveSecret(definition.key);
        return {
          key: definition.key,
          secret: true as const,
          configured: resolved.configured,
          source: resolved.source,
          description: definition.description,
          envFallback: definition.envFallback,
        };
      })
    ),
  ]);

  // Secret VALUES are never included in responses - only whether one is set.
  return NextResponse.json({
    config: [...entries, ...secretStates].filter((entry) => isDirectoryEmailConfigKey(entry.key)),
  });
}

interface WriteBody {
  values?: unknown;
  reason?: unknown;
}

async function directAdIsEnabled(tx: Prisma.TransactionClient): Promise<boolean> {
  const storedPolicy = await tx.systemConfigEntry.findUnique({
    where: { key: SIGN_IN_POLICY_KEY },
    select: { value: true },
  });
  if (storedPolicy) return validatePortalSignInPolicy(storedPolicy.value).methods.nativeAd.enabled;

  const settings = await tx.systemSettings.findFirst({
    orderBy: { createdAt: 'desc' },
    select: { authMode: true },
  });
  const legacyMode = settings?.authMode || process.env.AUTH_MODE?.trim() || 'native';
  return legacyMode === 'native'
    || (legacyMode === 'oidc' && getOidcSignInMethods().includes('native_ad'));
}

async function transactionConfigString(tx: Prisma.TransactionClient, key: string): Promise<string> {
  const stored = await tx.systemConfigEntry.findUnique({ where: { key }, select: { value: true } });
  if (stored) return getConfigDefinition(key)!.validate(stored.value) as string;
  const envName = getConfigDefinition(key)!.envFallback;
  return envName ? process.env[envName]?.trim() ?? '' : '';
}

async function transactionSecretString(tx: Prisma.TransactionClient, key: string): Promise<string> {
  const stored = await tx.systemConfigEntry.findUnique({ where: { key }, select: { value: true } });
  if (stored) {
    if (!stored.value || typeof stored.value !== 'object' || Array.isArray(stored.value)) {
      throw new Error(`Stored configuration key ${key} has an invalid secret envelope`);
    }
    const envelope = stored.value as { __secret?: unknown; data?: unknown };
    if (envelope.__secret === 'enc-v1' && typeof envelope.data === 'string') {
      return decryptPassword(envelope.data);
    }
    throw new Error(`Stored configuration key ${key} has an invalid secret envelope`);
  }
  const envName = getSecretDefinition(key)!.envFallback;
  return process.env[envName]?.trim() ?? '';
}

async function assertDirectAdConfigurationRemainsUsable(tx: Prisma.TransactionClient): Promise<void> {
  if (!(await directAdIsEnabled(tx))) return;
  const [url, domain, bindDn, bindPassword, searchBase] = await Promise.all([
    transactionConfigString(tx, 'ldap.url'),
    transactionConfigString(tx, 'ldap.domain'),
    transactionConfigString(tx, 'ldap.bindDn'),
    transactionSecretString(tx, 'ldap.bindPassword'),
    transactionConfigString(tx, 'ldap.searchBase'),
  ]);
  const ready = url.toLowerCase().startsWith('ldaps://')
    && Boolean(domain) && Boolean(bindDn) && Boolean(bindPassword) && Boolean(searchBase);
  if (!ready) throw new Error('DIRECT_AD_POLICY_WOULD_BECOME_UNUSABLE');
}

export async function PUT(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'directory.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await parseJsonWithLimit<WriteBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
      return NextResponse.json({ error: 'values must be an object of key -> value' }, { status: 400 });
    }

    const entries = Object.entries(body.values as Record<string, unknown>);
    if (entries.length === 0) {
      return NextResponse.json({ error: 'No configuration values provided' }, { status: 400 });
    }

    // Validate everything before writing anything: a partial save must never
    // leave directory/email connectivity half-configured.
    const validated: Array<{ key: string; value: unknown; secret: boolean }> = [];
    for (const [key, rawValue] of entries) {
      if (!isDirectoryEmailConfigKey(key)) {
        return NextResponse.json(
          { error: `Configuration key ${key} is not managed by the directory and email endpoint` },
          { status: 403 }
        );
      }
      if (!isKnownConfigKey(key)) {
        return NextResponse.json({ error: `Unknown configuration key: ${key}` }, { status: 400 });
      }
      // Empty string clears the override so env/default takes over again.
      if (rawValue === null || (typeof rawValue === 'string' && !rawValue.trim())) {
        validated.push({ key, value: null, secret: Boolean(getSecretDefinition(key)) });
        continue;
      }
      const secretDefinition = getSecretDefinition(key);
      if (secretDefinition) {
        // Secrets arrive as plaintext and are stored encrypted; the plaintext
        // is never persisted or logged.
        validated.push({ key, value: String(rawValue), secret: true });
        continue;
      }
      try {
        validated.push({ key, value: getConfigDefinition(key)!.validate(rawValue), secret: false });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : `Invalid value for ${key}` },
          { status: 400 }
        );
      }
    }

    const reason = normalizeRevisionReason(body.reason);
    const auditEntry = {
      action: AuditActions.UPDATE_SETTINGS,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetType: 'SystemConfigEntry',
      eventKind: 'write',
      outcome: 'success',
      details: { changedKeys: validated.map((entry) => entry.key) },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    } as const;

    // Config values, encrypted secrets, revision history, and the durable
    // audit entry commit together. A failed later key cannot leave a partial
    // directory/email configuration behind.
    const changesDirectory = validated.some((entry) => entry.key.startsWith('ldap.'));
    const changedKeys = await prisma.$transaction(async (tx) => {
      if (changesDirectory) {
        await tx.$queryRaw<Array<{ lock_acquired: string }>>`
          SELECT 'locked'::text AS lock_acquired
          FROM pg_advisory_xact_lock(hashtextextended(${SIGN_IN_POLICY_KEY}, 771924))
        `;
      }
      const changed: string[] = [];
      for (const entry of validated) {
        const existing = await tx.systemConfigEntry.findUnique({ where: { key: entry.key } });
        if (entry.value === null) {
          if (!existing) continue;
          await tx.systemConfigEntry.delete({ where: { key: entry.key } });
          await tx.configurationRevision.create({ data: {
            key: entry.key,
            previousValue: entry.secret ? SECRET_REVISION_MARKER : existing.value as Prisma.InputJsonValue,
            newValue: Prisma.DbNull,
            changeKind: entry.secret ? 'secret_change' : 'clear',
            changedBy: admin.username,
            reason,
          } });
          changed.push(entry.key);
          continue;
        }

        const value = entry.secret
          ? { __secret: 'enc-v1', data: encryptPassword(String(entry.value)) }
          : entry.value;
        await tx.systemConfigEntry.upsert({
          where: { key: entry.key },
          update: { value: value as Prisma.InputJsonValue, updatedBy: admin.username },
          create: { key: entry.key, value: value as Prisma.InputJsonValue, updatedBy: admin.username },
        });
        await tx.configurationRevision.create({ data: {
          key: entry.key,
          previousValue: entry.secret ? (existing ? SECRET_REVISION_MARKER : Prisma.DbNull) : (existing?.value as Prisma.InputJsonValue ?? Prisma.DbNull),
          newValue: entry.secret ? SECRET_REVISION_MARKER : entry.value as Prisma.InputJsonValue,
          changeKind: entry.secret ? 'secret_change' : 'update',
          changedBy: admin.username,
          reason,
        } });
        changed.push(entry.key);
      }
      if (changesDirectory) {
        // Invalidate before the transaction releases the policy lock. A policy
        // writer waiting on that lock must re-read the committed LDAP values,
        // not reuse a readiness snapshot populated before this transaction.
        clearConfigCache();
        await assertDirectAdConfigurationRemainsUsable(tx);
      }
      await logAuditAction({ ...auditEntry, details: { changedKeys: changed } }, tx, { emitOperationalLog: false });
      return changed;
    });

    clearConfigCache();
    emitAuditActionLog({ ...auditEntry, details: { changedKeys } });
    return NextResponse.json({ updated: changedKeys });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof Error && error.message === 'DIRECT_AD_POLICY_WOULD_BECOME_UNUSABLE') {
      return NextResponse.json(
        { error: 'This change would make an enabled direct Active Directory sign-in method unusable. Enable another policy or complete the LDAP configuration first.' },
        { status: 409 }
      );
    }
    console.error('Error updating directory/email configuration:', error);
    return NextResponse.json({ error: 'Failed to update configuration' }, { status: 500 });
  }
}
