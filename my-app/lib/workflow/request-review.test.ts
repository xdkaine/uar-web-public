import { describe, expect, it } from 'vitest';
import { projectRequestReview } from './request-review';
import type { ResolvedWorkflow } from './core';

const actor = {
  username: 'reviewer',
  roles: new Set<string>(),
  permissions: new Set(['access_requests.review.director', 'access_requests.review.faculty'] as const),
  viaLegacyAdminFallback: false,
};

function workflow(stages: ResolvedWorkflow['stages']): ResolvedWorkflow {
  return { id: 'wf-2', requestTypeKey: 'standard_access', version: 2, stages, source: 'pinned', integrity: 'valid' };
}

describe('request review projection', () => {
  it('uses pinned labels, order, and final-stage actions', () => {
    const projected = projectRequestReview({ status: 'pending_student_directors' }, workflow([
      { key: 'faculty', label: 'Initial policy review', reviewerRoleKey: 'faculty' },
      { key: 'student_directors', label: 'Final directory review', reviewerRoleKey: 'director' },
    ]), actor);
    expect(projected.currentStage).toMatchObject({ label: 'Final directory review', order: 1, isFinal: true });
    expect(projected.actions).toMatchObject({ canAcknowledge: false, canApprove: true, supportsFacultyHandoff: false });
  });

  it('supports a one-stage final workflow without legacy handoff controls', () => {
    const projected = projectRequestReview({ status: 'pending_faculty' }, workflow([
      { key: 'faculty', label: 'Access owner decision', reviewerRoleKey: 'faculty' },
    ]), actor);
    expect(projected.actions.canApprove).toBe(true);
    expect(projected.actions.canAcknowledge).toBe(false);
    expect(projected.actions.supportsFacultyHandoff).toBe(false);
  });

  it('disables all actions and warns when the current stage is absent', () => {
    const projected = projectRequestReview({ status: 'pending_student_directors' }, workflow([
      { key: 'faculty', label: 'Faculty', reviewerRoleKey: 'faculty' },
    ]), actor);
    expect(projected.workflow.integrity).toBe('current_stage_missing');
    expect(projected.workflow.warning).toContain('not represented');
    expect(projected.actions).toMatchObject({ canAcknowledge: false, canApprove: false, canReject: false });
  });
});
