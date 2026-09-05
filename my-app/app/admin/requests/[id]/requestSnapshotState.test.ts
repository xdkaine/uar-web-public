import { expect, it } from 'vitest';
import { initialRequestSnapshot, requestSnapshotReducer, type RequestSnapshotPayload } from './requestSnapshotState';

const request: RequestSnapshotPayload['request'] = {
  id: 'fixture-request', version: 1, createdAt: '2026-09-04T00:00:00Z', updatedAt: '2026-09-04T00:00:00Z',
  name: 'Synthetic requester', email: 'requester@example.test', isInternal: false, needsDomainAccount: true,
  isVerified: true, status: 'pending_faculty', acknowledgedByDirector: true,
};

it('publishes one server snapshot and defaults missing capabilities to no authority', () => {
  const enabled = { canRespond: true, canProvision: true, canReviewDirector: true, canReviewFaculty: true, canRejectPreVerification: true };
  const prior = requestSnapshotReducer(initialRequestSnapshot, { type: 'loaded', payload: { request, capabilities: enabled, actorDisplayNames: { actor: 'Synthetic actor' }, facultyHandoffTemplate: 'Template', vpnModuleEnabled: true } });
  const next = requestSnapshotReducer(prior, { type: 'loaded', payload: { request: { ...request, version: 2 } } });
  expect(next.request?.version).toBe(2);
  expect(Object.values(next.capabilities)).toEqual([false, false, false, false, false]);
  expect(next.actorDisplayNames).toEqual({});
  expect(next.facultyHandoffTemplate).toBeNull();
  expect(next.review).toBeNull();
  expect(next.vpnModuleEnabled).toBe(false);
});

it('defaults the recovery selection once and preserves the operator selection across refresh', () => {
  const payload = { request, workflowRecoveryOptions: [{ id: 'first', version: 1, status: 'active', stageLabels: [] }] };
  const loaded = requestSnapshotReducer(initialRequestSnapshot, { type: 'loaded', payload });
  expect(loaded.recoveryWorkflowId).toBe('first');
  const selected = requestSnapshotReducer(loaded, { type: 'recoveryWorkflowSelected', id: 'chosen' });
  expect(requestSnapshotReducer(selected, { type: 'loaded', payload }).recoveryWorkflowId).toBe('chosen');
});
