import { describe, expect, it } from 'vitest';
import { MAX_CHECKS_PER_SOURCE, monitorCheckConfigHash, validateWorkflowMonitorCheck, validateWorkflowMonitorChecks } from './workflow-checks';

const base = { key: 'portal', name: 'Portal', kind: 'https', host: 'portal.internal.example', port: 443, path: '/health', method: 'GET', intervalSeconds: 60, timeoutMs: 5000, failureThreshold: 2, recoveryThreshold: 2, enabled: true };

describe('workflow monitor check policy', () => {
  it('normalizes a bounded HTTPS check and produces a stable hash', () => {
    const result = validateWorkflowMonitorCheck({ ...base, legacyEndpointId: 'legacy_target_1' });
    expect(result).toMatchObject({ ok: true, value: { key: 'portal', host: 'portal.internal.example', expectedStatusMin: 200, expectedStatusMax: 499 } });
    if (result.ok) {
      expect(monitorCheckConfigHash(result.value)).toBe(
        monitorCheckConfigHash({ ...result.value, legacyEndpointId: 'legacy_target_2' })
      );
    }
  });

  it('rejects credentials over plaintext HTTP and out-of-range schedules', () => {
    expect(validateWorkflowMonitorCheck({ ...base, kind: 'http', port: 80, credentialRef: 'secret-1' })).toMatchObject({ ok: false });
    expect(validateWorkflowMonitorCheck({ ...base, intervalSeconds: 59 })).toMatchObject({ ok: false });
    expect(validateWorkflowMonitorCheck({ ...base, timeoutMs: 15001 })).toMatchObject({ ok: false });
  });

  it('enforces per-source capacity and stable-key uniqueness', () => {
    expect(validateWorkflowMonitorChecks([base, { ...base }])).toMatchObject({ ok: false, errors: [expect.stringContaining('unique')] });
    expect(validateWorkflowMonitorChecks(Array.from({ length: MAX_CHECKS_PER_SOURCE + 1 }, (_, index) => ({ ...base, key: `check_${index}` })))).toMatchObject({ ok: false });
  });
});
