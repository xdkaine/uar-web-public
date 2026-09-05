import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workflowDefinition: {
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
    },
  },
}));

import {
  clearWorkflowCache,
  firstReviewStatus,
  getActiveWorkflow,
  isFinalStageStatus,
  nextReviewStatusAfter,
  resolveStageNotificationRecipients,
  resolveWorkflowForRequest,
  supportsFacultyHandoffActions,
} from './core';
import {
  DEFAULT_STANDARD_WORKFLOW_STAGES,
  validateWorkflowStages,
  WORKFLOW_STAGE_CATALOG,
} from './schema';

beforeEach(() => {
  vi.clearAllMocks();
  clearWorkflowCache();
});

describe('validateWorkflowStages', () => {
  it('accepts the default two-stage workflow', () => {
    const result = validateWorkflowStages(DEFAULT_STANDARD_WORKFLOW_STAGES);
    expect(result.ok).toBe(true);
  });

  it('accepts a single-stage faculty-only configuration with custom labels', () => {
    const result = validateWorkflowStages([
      { key: 'faculty', label: 'Admin Review', reviewerRoleKey: 'faculty' },
    ]);
    expect(result.ok).toBe(true);
  });

  it('rejects empty, oversized, duplicate, and unknown stage lists', () => {
    expect(validateWorkflowStages([]).ok).toBe(false);
    expect(
      validateWorkflowStages([
        { key: 'student_directors', label: 'A', reviewerRoleKey: 'director' },
        { key: 'faculty', label: 'B', reviewerRoleKey: 'faculty' },
        { key: 'extra', label: 'C', reviewerRoleKey: 'x' },
      ]).ok
    ).toBe(false);
    expect(
      validateWorkflowStages([
        { key: 'faculty', label: 'A', reviewerRoleKey: 'faculty' },
        { key: 'faculty', label: 'B', reviewerRoleKey: 'faculty' },
      ]).ok
    ).toBe(false);
    expect(validateWorkflowStages([{ key: 'nope', label: 'X', reviewerRoleKey: 'r' }]).ok).toBe(false);
  });

  it('rejects bad labels, roles, and notify emails', () => {
    expect(validateWorkflowStages([{ key: 'faculty', label: '   ', reviewerRoleKey: 'faculty' }]).ok).toBe(false);
    expect(validateWorkflowStages([{ key: 'faculty', label: 'F', reviewerRoleKey: '' }]).ok).toBe(false);
    expect(validateWorkflowStages([{ key: 'faculty', label: 'F', reviewerRoleKey: 'typo-role' }]).ok).toBe(false);
    expect(
      validateWorkflowStages([{ key: 'faculty', label: 'F', reviewerRoleKey: 'faculty', notifyEmails: ['not-an-email'] }])
        .ok
    ).toBe(false);
    expect(
      validateWorkflowStages([
        { key: 'faculty', label: 'F', reviewerRoleKey: 'faculty', notifyEmails: ['chair@example.test'] },
      ]).ok
    ).toBe(true);
  });
});

describe('transition helpers', () => {
  it('maps the seeded default exactly like current behavior', () => {
    expect(firstReviewStatus(DEFAULT_STANDARD_WORKFLOW_STAGES)).toBe('pending_student_directors');
    expect(nextReviewStatusAfter(DEFAULT_STANDARD_WORKFLOW_STAGES, 'pending_student_directors')).toBe(
      'pending_faculty'
    );
    expect(nextReviewStatusAfter(DEFAULT_STANDARD_WORKFLOW_STAGES, 'pending_faculty')).toBeNull();
    expect(isFinalStageStatus(DEFAULT_STANDARD_WORKFLOW_STAGES, 'pending_faculty')).toBe(true);
    expect(isFinalStageStatus(DEFAULT_STANDARD_WORKFLOW_STAGES, 'pending_student_directors')).toBe(false);
  });

  it('supports single-stage workflows where acknowledge and approval coincide on one status', () => {
    const stages = [{ key: 'faculty' as const, label: 'Review', reviewerRoleKey: 'faculty', notifyEmails: null }];
    expect(firstReviewStatus(stages)).toBe(WORKFLOW_STAGE_CATALOG.faculty.status);
    expect(isFinalStageStatus(stages, WORKFLOW_STAGE_CATALOG.faculty.status)).toBe(true);
    expect(supportsFacultyHandoffActions(stages)).toBe(false);
  });

  it('reports handoff support only for the exact directors -> faculty shape', () => {
    expect(supportsFacultyHandoffActions(DEFAULT_STANDARD_WORKFLOW_STAGES)).toBe(true);
    expect(
      supportsFacultyHandoffActions([{ key: 'faculty' as const, label: 'R', reviewerRoleKey: 'faculty' }])
    ).toBe(false);
  });

  it('returns null transitions for statuses outside the configured stages', () => {
    expect(nextReviewStatusAfter(DEFAULT_STANDARD_WORKFLOW_STAGES, 'pending_verification')).toBeNull();
  });
});

describe('getActiveWorkflow', () => {
  it('falls back to built-in defaults when nothing is stored', async () => {
    mocks.findFirst.mockResolvedValue(null);

    const workflow = await getActiveWorkflow();
    expect(workflow.id).toBeNull();
    expect(workflow.stages).toEqual(DEFAULT_STANDARD_WORKFLOW_STAGES);
  });

  it('prefers the highest published version', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'wf-v2',
      requestTypeKey: 'standard_access',
      version: 2,
      status: 'published',
      stages: [{ key: 'faculty', label: 'Faculty Only', reviewerRoleKey: 'faculty', notifyEmails: null }],
    });

    const workflow = await getActiveWorkflow();
    expect(workflow.id).toBe('wf-v2');
    expect(workflow.version).toBe(2);
    expect(workflow.stages[0].key).toBe('faculty');
  });

  it('does not pin a corrupt published definition into new requests', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'wf-corrupt-active',
      requestTypeKey: 'standard_access',
      version: 9,
      status: 'published',
      stages: [],
    });

    const workflow = await getActiveWorkflow();

    expect(workflow.id).toBeNull();
    expect(workflow.source).toBe('builtin');
    expect(workflow.stages).toEqual(DEFAULT_STANDARD_WORKFLOW_STAGES);
  });

  it('fails open to defaults when the store is unreadable', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.findFirst.mockRejectedValue(new Error('db down'));

    const workflow = await getActiveWorkflow();
    expect(workflow.id).toBeNull();
    consoleError.mockRestore();
  });

  it('never serves archived-only history as active; only published versions qualify', async () => {
    mocks.findFirst.mockResolvedValue(null);

    const workflow = await getActiveWorkflow();

    expect(workflow.id).toBeNull();
    expect(workflow.stages).toEqual(DEFAULT_STANDARD_WORKFLOW_STAGES);
    expect(mocks.findFirst).toHaveBeenCalledTimes(1);
    expect(mocks.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestTypeKey: 'standard_access', status: 'published' },
      })
    );
  });
});

describe('resolveWorkflowForRequest', () => {
  it('pins to the stored version for requests that reference one', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'wf-v1',
      requestTypeKey: 'standard_access',
      version: 1,
      status: 'archived',
      stages: DEFAULT_STANDARD_WORKFLOW_STAGES,
    });

    const workflow = await resolveWorkflowForRequest({ workflowVersionId: 'wf-v1' });
    expect(workflow.id).toBe('wf-v1');
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('uses the active default for unpinned legacy requests', async () => {
    mocks.findFirst.mockResolvedValue(null);

    const workflow = await resolveWorkflowForRequest({ workflowVersionId: null });
    expect(workflow.id).toBeNull();
    expect(workflow.stages).toEqual(DEFAULT_STANDARD_WORKFLOW_STAGES);
  });

  it('fails closed when the pinned definition was deleted', async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.findFirst.mockResolvedValue(null);

    const workflow = await resolveWorkflowForRequest({ workflowVersionId: 'gone' });
    expect(workflow.id).toBe('gone');
    expect(workflow.integrity).toBe('missing_definition');
    expect(workflow.stages).toEqual([]);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('fails closed when pinned stages are corrupt', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'wf-corrupt', requestTypeKey: 'standard_access', version: 4, status: 'archived', stages: [],
    });

    const workflow = await resolveWorkflowForRequest({ workflowVersionId: 'wf-corrupt', requestTypeKey: 'standard_access' });
    expect(workflow.integrity).toBe('corrupt_definition');
    expect(workflow.stages).toEqual([]);
  });

  it('fails closed when the pin belongs to another request type', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'wf-other', requestTypeKey: 'other_access', version: 1, status: 'published', stages: DEFAULT_STANDARD_WORKFLOW_STAGES,
    });

    const workflow = await resolveWorkflowForRequest({ workflowVersionId: 'wf-other', requestTypeKey: 'standard_access' });
    expect(workflow.integrity).toBe('request_type_mismatch');
    expect(workflow.stages).toEqual([]);
  });

  it('fails closed when the pin points to a mutable draft definition', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'wf-draft', requestTypeKey: 'standard_access', version: 2, status: 'draft', stages: DEFAULT_STANDARD_WORKFLOW_STAGES,
    });

    const workflow = await resolveWorkflowForRequest({ workflowVersionId: 'wf-draft', requestTypeKey: 'standard_access' });
    expect(workflow.integrity).toBe('invalid_definition_status');
    expect(workflow.stages).toEqual([]);
  });
});

describe('resolveStageNotificationRecipients', () => {
  it('prefers the stage-pinned list, deduplicated and lowercased', async () => {
    const recipients = await resolveStageNotificationRecipients(
      { key: 'faculty', label: 'Faculty', reviewerRoleKey: 'faculty', notifyEmails: ['Chair@Example.edu', 'chair@example.edu', ' dean@example.edu '] },
      async () => ['fallback@example.edu']
    );
    expect(recipients).toEqual(['chair@example.edu', 'dean@example.edu']);
  });

  it('falls back to the global configuration when the stage pins nothing', async () => {
    const recipients = await resolveStageNotificationRecipients(
      { key: 'faculty', label: 'Faculty', reviewerRoleKey: 'faculty', notifyEmails: [] },
      async () => ['global@example.edu']
    );
    expect(recipients).toEqual(['global@example.edu']);
  });

  it('honors the fallback for stages without any recipient field', async () => {
    const recipients = await resolveStageNotificationRecipients(undefined, async () => [
      'legacy@example.edu',
    ]);
    expect(recipients).toEqual(['legacy@example.edu']);
  });
});
