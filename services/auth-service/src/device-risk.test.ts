import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { assessDeviceRisk, recordShadowDeviceObservation } from './device-risk';

describe('device risk shadow evaluation', () => {
  it('recognizes a returning cookie without treating the fingerprint as authentication', () => {
    expect(
      assessDeviceRisk(
        { username: 'alice', ipAddress: '10.0.0.9', userAgent: 'Chrome/1' },
        [{ deviceCookieHash: 'known', fingerprintHash: null, ipAddress: '10.0.0.2', userAgent: 'Chrome/1' }],
        { deviceCookieHashes: ['known'], fingerprintHashes: ['spoofable'] }
      )
    ).toEqual({ score: 0, level: 'low', reasons: ['recognized_device_cookie'] });
  });

  it('raises triage evidence for a new browser and network but does not return an enforcement action', () => {
    const result = assessDeviceRisk(
      { username: 'alice', ipAddress: '10.2.0.9', userAgent: 'Firefox/1' },
      [{ deviceCookieHash: 'old', fingerprintHash: 'old', ipAddress: '10.1.0.2', userAgent: 'Chrome/1' }],
      { deviceCookieHashes: ['new'], fingerprintHashes: ['new'] }
    );
    expect(result).toEqual({
      score: 65,
      level: 'high',
      reasons: ['new_device_evidence', 'network_changed', 'browser_family_changed'],
    });
    expect(result).not.toHaveProperty('allow');
  });

  it('does not query or write while the feature is off', async () => {
    const store = { findMany: async () => { throw new Error('unexpected'); }, create: async () => { throw new Error('unexpected'); } };
    await expect(
      recordShadowDeviceObservation(
        { deviceRiskMode: 'off', deviceEvidenceKey: '' },
        { username: 'alice' },
        store
      )
    ).resolves.toBeNull();
  });

  it('dual-reads a previous HMAC key while writing with the active key', async () => {
    const active = 'active-device-evidence-key-at-least-32-characters';
    const previous = 'previous-device-evidence-key-at-least-32-characters';
    const cookie = '0f0f0f0f-1111-2222-3333-444455556666';
    const oldHash = createHmac('sha256', previous).update(`cookie\0${cookie}`).digest('base64url');
    let written: Record<string, unknown> | undefined;
    const store = {
      findMany: async () => [{ deviceCookieHash: oldHash, fingerprintHash: null, ipAddress: '10.0.0.1', userAgent: 'Chrome/1' }],
      create: async (args: unknown) => { written = (args as { data: Record<string, unknown> }).data; return {}; },
    };
    const result = await recordShadowDeviceObservation(
      { deviceRiskMode: 'shadow', deviceEvidenceKey: active, deviceEvidencePreviousKeys: [previous] },
      { username: 'alice', deviceCookieId: cookie, ipAddress: '10.0.0.2', userAgent: 'Chrome/1' },
      store
    );
    expect(result?.reasons).toContain('recognized_device_cookie');
    expect(written?.deviceCookieHash).toBe(
      createHmac('sha256', active).update(`cookie\0${cookie}`).digest('base64url')
    );
  });
});
