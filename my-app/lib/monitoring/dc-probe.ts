import { Client } from 'ldapts';
import { createLDAPClient } from '@/lib/ldap/client';
import { getConfigValue, getRequiredSecretValue } from '@/lib/config/resolver';
import { withTimeout, LDAP_TIMEOUT } from '@/lib/ldap/utils';
import { emitAutomationEvent } from '@/lib/automation/emit';
import { prisma } from '@/lib/prisma';
import { appLogger } from '@/lib/logger';

export const DC_PROBE_SOURCE = 'dc_probe';
export const DC_EVENT_BUCKET_MS = 15 * 60 * 1000;

export interface DirectoryProbeOutcome {
  reachable: boolean;
  target: string;
  latencyMs?: number;
  error?: string;
}

export interface DirectoryHealthCycleResult {
  probe: DirectoryProbeOutcome;
  emitted: {
    triggerKey: string;
    eventKey: string;
    rulesConsidered: number;
    summaries: Array<{
      ruleId: string;
      ruleName: string;
      status: string;
      matched: boolean;
      error?: string;
    }>;
  } | null;
}

function eventBucket(): number {
  return Math.floor(Date.now() / DC_EVENT_BUCKET_MS);
}

export async function probeDirectory(): Promise<DirectoryProbeOutcome> {
  let client: Client | null = null;
  try {
    const [target, bindDN, bindPassword] = await Promise.all([
      getConfigValue<string>('ldap.url'),
      getConfigValue<string>('ldap.bindDn'),
      getRequiredSecretValue('ldap.bindPassword'),
    ]);

    client = await createLDAPClient();
    const startedAt = Date.now();
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);
    await withTimeout(
      client.search('', {
        filter: '(objectClass=*)',
        scope: 'base' as const,
        attributes: ['rootDomainNamingContext'],
      }),
      LDAP_TIMEOUT
    );
    return { reachable: true, target, latencyMs: Date.now() - startedAt };
  } catch {
    // Coarse by design: LDAP exceptions may contain hosts, DNs, or bind
    // context. Detailed diagnosis stays in the protected server log path.
    const sanitized = 'Directory service did not respond';
    appLogger.warn('Directory health probe failed', { error: sanitized });
    const target = await getConfigValue<string>('ldap.url').catch(() => 'unknown');
    return { reachable: false, target, error: sanitized };
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindError) {
        appLogger.error('Directory health probe failed to unbind', unbindError);
      }
    }
  }
}

async function hasActiveDirectoryAlerts(): Promise<boolean> {
  const active = await prisma.serviceAlert.findFirst({
    where: { status: 'active', category: 'directory' },
    select: { id: true },
  });
  return !!active;
}

export async function runDirectoryHealthCycle(): Promise<DirectoryHealthCycleResult> {
  const probe = await probeDirectory();

  if (!probe.reachable) {
    const eventKey = `dc_unreachable:${eventBucket()}`;
    const emitted = await emitAutomationEvent('dc_unreachable', eventKey, {
      probeSource: DC_PROBE_SOURCE,
      target: probe.target,
      error: probe.error ?? 'unknown error',
    });
    try {
      const { emitFlowEvent } = await import('@/lib/flow/engine');
      await emitFlowEvent('dc_unreachable', `flow:${eventKey}`, {
        target: probe.target,
        error: probe.error ?? 'unknown error',
      });
    } catch (flowError) {
      appLogger.error('[DcProbe] Flow emission failed', flowError instanceof Error ? flowError : undefined);
    }
    return { probe, emitted };
  }

  const shouldAnnounceRecovery = await hasActiveDirectoryAlerts();
  if (!shouldAnnounceRecovery) {
    return { probe, emitted: null };
  }

  const eventKey = `dc_recovered:${eventBucket()}`;
  const emitted = await emitAutomationEvent('dc_recovered', eventKey, {
    probeSource: DC_PROBE_SOURCE,
    target: probe.target,
  });
  try {
    const { emitFlowEvent } = await import('@/lib/flow/engine');
    await emitFlowEvent('dc_recovered', `flow:${eventKey}`, { target: probe.target });
  } catch (flowError) {
    appLogger.error('[DcProbe] Flow recovery emission failed', flowError instanceof Error ? flowError : undefined);
  }
  return { probe, emitted };
}
