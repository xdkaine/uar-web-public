import { createHmac } from 'node:crypto';
import { prisma } from './db';

const EVIDENCE_RETENTION_DAYS = 365;

export interface DeviceRiskInput {
  username: string;
  clientId?: string;
  deviceCookieId?: string;
  fingerprint?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** OIDC authentication authority; currently Active Directory only. */
  method?: 'ad';
}

export interface DeviceRiskAssessment {
  score: number;
  level: 'low' | 'medium' | 'high';
  reasons: string[];
}

interface PreviousObservation {
  deviceCookieHash: string | null;
  fingerprintHash: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

interface DeviceObservationStore {
  findMany(args: unknown): Promise<PreviousObservation[]>;
  create(args: unknown): Promise<unknown>;
}

function evidenceHash(key: string, kind: string, value: string | undefined): string | null {
  if (!value) return null;
  return createHmac('sha256', key).update(`${kind}\0${value}`).digest('base64url');
}

function networkPrefix(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (ipv4 && ipv4.slice(1).every((part) => Number(part) <= 255)) {
    return `${ipv4[1]}.${ipv4[2]}.${ipv4[3]}.0/24`;
  }
  if (ip.includes(':')) return `${ip.split(':').slice(0, 4).join(':')}::/64`;
  return null;
}

function userAgentFamily(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Chrome\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return ua ? 'other' : 'unknown';
}

export function assessDeviceRisk(
  input: DeviceRiskInput,
  previous: PreviousObservation[],
  hashes: { deviceCookieHashes: string[]; fingerprintHashes: string[] }
): DeviceRiskAssessment {
  const reasons: string[] = [];
  let score = 0;
  const recognizedCookie = Boolean(
    hashes.deviceCookieHashes.length && previous.some((row) => row.deviceCookieHash && hashes.deviceCookieHashes.includes(row.deviceCookieHash))
  );
  const recognizedFingerprint = Boolean(
    hashes.fingerprintHashes.length && previous.some((row) => row.fingerprintHash && hashes.fingerprintHashes.includes(row.fingerprintHash))
  );

  if (previous.length === 0) {
    score = 10;
    reasons.push('first_observation');
  } else if (recognizedCookie) {
    reasons.push('recognized_device_cookie');
  } else if (recognizedFingerprint) {
    score = 15;
    reasons.push('recognized_fingerprint_new_cookie');
  } else {
    score = 40;
    reasons.push('new_device_evidence');
  }

  const latest = previous[0];
  const currentNetwork = networkPrefix(input.ipAddress);
  const previousNetwork = networkPrefix(latest?.ipAddress);
  if (latest && currentNetwork && previousNetwork && currentNetwork !== previousNetwork) {
    score += 15;
    reasons.push('network_changed');
  }
  if (latest && userAgentFamily(input.userAgent) !== userAgentFamily(latest.userAgent)) {
    score += 10;
    reasons.push('browser_family_changed');
  }
  score = Math.min(score, 100);
  const level = score >= 60 ? 'high' : score >= 30 ? 'medium' : 'low';
  return { score, level, reasons };
}

/**
 * Persist evidence for security triage. This is deliberately shadow-only:
 * callers may log/alert on the result, but it cannot alter authentication.
 */
export async function recordShadowDeviceObservation(
  config: {
    deviceRiskMode: 'off' | 'shadow';
    deviceEvidenceKey: string;
    deviceEvidencePreviousKeys?: string[];
  },
  input: DeviceRiskInput,
  store: DeviceObservationStore = prisma.deviceObservation as unknown as DeviceObservationStore
): Promise<DeviceRiskAssessment | null> {
  if (config.deviceRiskMode !== 'shadow') return null;

  const deviceCookieHash = evidenceHash(config.deviceEvidenceKey, 'cookie', input.deviceCookieId);
  const fingerprintHash = evidenceHash(config.deviceEvidenceKey, 'fingerprint', input.fingerprint);
  const matchingKeys = [config.deviceEvidenceKey, ...(config.deviceEvidencePreviousKeys ?? [])];
  const deviceCookieHashes = matchingKeys
    .map((key) => evidenceHash(key, 'cookie', input.deviceCookieId))
    .filter((hash): hash is string => Boolean(hash));
  const fingerprintHashes = matchingKeys
    .map((key) => evidenceHash(key, 'fingerprint', input.fingerprint))
    .filter((hash): hash is string => Boolean(hash));
  const since = new Date(Date.now() - EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const previous = await store.findMany({
    where: { username: input.username.toLowerCase(), observedAt: { gte: since } },
    select: { deviceCookieHash: true, fingerprintHash: true, ipAddress: true, userAgent: true },
    orderBy: { observedAt: 'desc' },
    take: 100,
  });
  const assessment = assessDeviceRisk(input, previous, { deviceCookieHashes, fingerprintHashes });
  const fingerprintVersion = input.fingerprint?.startsWith('v2-') ? 2 : 1;
  const observedAt = new Date();
  const expiresAt = new Date(observedAt.getTime() + EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  await store.create({
    data: {
      username: input.username.toLowerCase(),
      clientId: input.clientId ?? null,
      deviceCookieHash,
      fingerprintHash,
      fingerprintVersion,
      signals: {
        cookiePresent: Boolean(input.deviceCookieId),
        fingerprintPresent: Boolean(input.fingerprint),
        browserFamily: userAgentFamily(input.userAgent),
      },
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      riskScore: assessment.score,
      riskLevel: assessment.level,
      riskReasons: assessment.reasons,
      enforcement: 'shadow',
      observedAt,
      expiresAt,
    },
  });
  return assessment;
}
