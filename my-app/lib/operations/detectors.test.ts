import { describe, expect, it } from 'vitest';

import {
  classifyAccessRequestInterventions,
  isRouteOverdue,
  routeStaleAfterMs,
} from './detectors';

const BASE_REQUEST = {
  id: 'request-1',
  status: 'pending_student_directors',
  provisioningState: null,
  provisioningStartedAt: null,
  provisioningCompletedAt: null,
  facultyNotificationState: null,
  facultyNotificationClaimedUntil: null,
  updatedAt: new Date('2026-08-28T12:29:00.000Z'),
};

describe('structured operational detectors', () => {
  it('uses the same three-cadence and five-minute scheduler threshold as the UI', () => {
    expect(routeStaleAfterMs(60)).toBe(5 * 60_000);
    expect(routeStaleAfterMs(600)).toBe(30 * 60_000);

    const now = new Date('2026-08-28T12:30:00.000Z');
    expect(isRouteOverdue(new Date('2026-08-28T12:00:01.000Z'), 600, now)).toBe(false);
    expect(isRouteOverdue(new Date('2026-08-28T11:59:59.000Z'), 600, now)).toBe(true);
  });

  it('does not treat ordinary governance waiting as a bug', () => {
    expect(classifyAccessRequestInterventions(BASE_REQUEST)).toEqual([]);
    expect(classifyAccessRequestInterventions({
      ...BASE_REQUEST,
      status: 'pending_faculty',
    })).toEqual([]);
  });

  it('detects terminal provisioning failures without persisting user PII', () => {
    const observations = classifyAccessRequestInterventions({
      ...BASE_REQUEST,
      provisioningState: 'reconciliation_required',
      provisioningStartedAt: new Date('2026-08-28T10:00:00.000Z'),
    });

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      detectorKey: 'access_request_intervention_required',
      reasonCode: 'terminal_provisioning_failure',
      severity: 'critical',
      subjectId: 'request-1',
    });
    expect(JSON.stringify(observations)).not.toMatch(/name|email|token|password/i);
  });

  it('detects stale processing and expired faculty delivery claims', () => {
    const now = new Date('2026-08-28T12:30:00.000Z');
    const observations = classifyAccessRequestInterventions({
      ...BASE_REQUEST,
      provisioningState: 'in_progress',
      provisioningStartedAt: new Date('2026-08-28T12:00:00.000Z'),
      facultyNotificationState: 'sending',
      facultyNotificationClaimedUntil: new Date('2026-08-28T12:20:00.000Z'),
    }, now);

    expect(observations.map((entry) => entry.reasonCode)).toEqual([
      'stale_provisioning_claim',
      'expired_faculty_delivery_claim',
    ]);
  });

  it('detects in-progress claims with missing lease timestamps', () => {
    const observations = classifyAccessRequestInterventions({
      ...BASE_REQUEST,
      provisioningState: 'approval_in_progress',
      facultyNotificationState: 'sending',
    });

    expect(observations.map((entry) => entry.reasonCode)).toEqual([
      'missing_provisioning_claim_timestamp',
      'missing_faculty_delivery_claim_expiry',
    ]);
  });

  it('detects the real batch and verification delivery leases by updatedAt', () => {
    const now = new Date('2026-08-28T12:30:00.000Z');
    for (const provisioningState of [
      'delivery_sending',
      'delivery_retrying',
      'verification_email_sending',
    ]) {
      const observations = classifyAccessRequestInterventions({
        ...BASE_REQUEST,
        provisioningState,
        updatedAt: new Date('2026-08-28T12:20:00.000Z'),
      }, now);
      expect(observations.map((entry) => entry.reasonCode)).toContain('stale_delivery_state');
    }
  });

  it('detects legacy batch provisioning through provisioningStartedAt', () => {
    const observations = classifyAccessRequestInterventions({
      ...BASE_REQUEST,
      provisioningState: 'provisioning',
      provisioningStartedAt: new Date('2026-08-28T12:00:00.000Z'),
    }, new Date('2026-08-28T12:30:00.000Z'));

    expect(observations.map((entry) => entry.reasonCode)).toContain('stale_provisioning_claim');
  });

  it('keeps a stale claim fingerprint stable as its displayed age changes', () => {
    const request = {
      ...BASE_REQUEST,
      provisioningState: 'in_progress',
      provisioningStartedAt: new Date('2026-08-28T12:00:00.000Z'),
    };
    const first = classifyAccessRequestInterventions(request, new Date('2026-08-28T12:20:00.000Z'))[0];
    const later = classifyAccessRequestInterventions(request, new Date('2026-08-28T12:25:00.000Z'))[0];

    expect(first?.evidence.ageMinutes).toBe(20);
    expect(later?.evidence.ageMinutes).toBe(25);
    expect(first?.fingerprint).toBe(later?.fingerprint);
  });
});
