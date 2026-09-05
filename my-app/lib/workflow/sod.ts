import { getConfigValue } from '@/lib/config/resolver';

/**
 * Segregation-of-duties guardrail for access-request governance (roadmap §8
 * evidence contract). The classic ITGC concern this addresses: the same
 * person performing two independent review actions on one request (for
 * example acknowledging as Director and later approving as Faculty).
 *
 * Modes are resolved through persisted configuration so operators can tune
 * enforcement without a deployment:
 *   off   - record nothing (current behavior; shipped default)
 *   flag  - allow the action, annotate the approval evidence
 *   block - reject the action before any state changes
 *
 * System administrators acting across stages are subject to exactly the same
 * evaluation: legacy admins keep their access, not an SoD exemption.
 */

export const SOD_MODES = ['off', 'flag', 'block'] as const;

export type SodMode = (typeof SOD_MODES)[number];

export function isValidSodMode(value: unknown): value is SodMode {
  return typeof value === 'string' && (SOD_MODES as readonly string[]).includes(value);
}

/** Resolve the configured mode; anything unusable falls back to "off". */
export async function resolveSodMode(): Promise<SodMode> {
  try {
    const value = await getConfigValue<string>('governance.sodMode');
    return isValidSodMode(value) ? value : 'off';
  } catch {
    return 'off';
  }
}

export interface SodPriorAction {
  /** Request column that produced the signal. */
  field: string;
  /** Human-readable stage/action name for evidence output. */
  label: string;
  actor: string;
  at: string | null;
}

/**
 * The subset of AccessRequest columns carrying earlier-stage actor identity.
 * Provisioning preparation (acknowledgement, faculty handoff, manual
 * assignment) counts as an earlier independent action relative to final
 * approval.
 */
export interface SodRelevantRequest {
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
  sentToFacultyBy: string | null;
  sentToFacultyAt: Date | null;
  manuallyAssignedBy: string | null;
  manuallyAssignedAt: Date | null;
}

const PRIOR_ACTION_FIELDS: Array<{
  field: keyof Omit<SodRelevantRequest, 'acknowledgedAt' | 'sentToFacultyAt' | 'manuallyAssignedAt'>;
  atField: 'acknowledgedAt' | 'sentToFacultyAt' | 'manuallyAssignedAt';
  label: string;
}> = [
  { field: 'acknowledgedBy', atField: 'acknowledgedAt', label: 'Earlier-stage acknowledgement' },
  { field: 'sentToFacultyBy', atField: 'sentToFacultyAt', label: 'Sent to faculty review' },
  { field: 'manuallyAssignedBy', atField: 'manuallyAssignedAt', label: 'Manual account assignment' },
];

/**
 * Prior stage actions on this request performed by the SAME actor. Comparison
 * is case-insensitive on trimmed usernames; directory sAMAccountNames are
 * case-insensitive identities.
 */
export function findPriorStageActionsByActor(
  request: SodRelevantRequest,
  actorUsername: string
): SodPriorAction[] {
  const actor = actorUsername.trim().toLowerCase();
  if (!actor) return [];

  const prior: SodPriorAction[] = [];
  for (const entry of PRIOR_ACTION_FIELDS) {
    const fieldActor = request[entry.field];
    if (!fieldActor) continue;
    if (fieldActor.trim().toLowerCase() !== actor) continue;
    prior.push({
      field: entry.field,
      label: entry.label,
      actor: fieldActor,
      at: request[entry.atField] ? request[entry.atField]!.toISOString() : null,
    });
  }
  return prior;
}

export interface SodEvaluation {
  mode: SodMode;
  violated: boolean;
  priorActions: SodPriorAction[];
}

/** Full evaluation for an approval attempt; never throws. */
export async function evaluateApprovalSeparationOfDuties(
  request: SodRelevantRequest,
  actorUsername: string
): Promise<SodEvaluation> {
  const mode = await resolveSodMode();
  const priorActions = findPriorStageActionsByActor(request, actorUsername);
  return { mode, violated: mode !== 'off' && priorActions.length > 0, priorActions };
}
