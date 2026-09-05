import type { AccessRequest, RequestCapabilities, RequestReview } from './RequestDetailTypes';

type RecoveryOption = { id: string; version: number; status: string; stageLabels: string[] };

export interface RequestSnapshotPayload {
  request: AccessRequest;
  actorDisplayNames?: Record<string, string>;
  capabilities?: RequestCapabilities;
  review?: RequestReview | null;
  workflowRecoveryOptions?: RecoveryOption[];
  facultyHandoffTemplate?: string | null;
  vpnModuleEnabled?: boolean;
}

interface RequestSnapshotState {
  request: AccessRequest | null;
  actorDisplayNames: Record<string, string>;
  capabilities: RequestCapabilities;
  review: RequestReview | null;
  workflowRecoveryOptions: RecoveryOption[];
  recoveryWorkflowId: string;
  facultyHandoffTemplate: string | null;
  vpnModuleEnabled: boolean;
}

const NO_REQUEST_CAPABILITIES: RequestCapabilities = {
  canRespond: false,
  canProvision: false,
  canReviewDirector: false,
  canReviewFaculty: false,
  canRejectPreVerification: false,
};

export const initialRequestSnapshot: RequestSnapshotState = {
  request: null,
  actorDisplayNames: {},
  capabilities: NO_REQUEST_CAPABILITIES,
  review: null,
  workflowRecoveryOptions: [],
  recoveryWorkflowId: '',
  facultyHandoffTemplate: null,
  vpnModuleEnabled: true,
};

type RequestSnapshotAction =
  | { type: 'loaded'; payload: RequestSnapshotPayload }
  | { type: 'recoveryWorkflowSelected'; id: string };

export function requestSnapshotReducer(state: RequestSnapshotState, action: RequestSnapshotAction): RequestSnapshotState {
  if (action.type === 'recoveryWorkflowSelected') return { ...state, recoveryWorkflowId: action.id };
  const data = action.payload;
  return {
    request: data.request,
    actorDisplayNames: data.actorDisplayNames ?? {},
    capabilities: data.capabilities ?? NO_REQUEST_CAPABILITIES,
    review: data.review ?? null,
    workflowRecoveryOptions: data.workflowRecoveryOptions ?? [],
    recoveryWorkflowId: state.recoveryWorkflowId || data.workflowRecoveryOptions?.[0]?.id || '',
    facultyHandoffTemplate: typeof data.facultyHandoffTemplate === 'string' ? data.facultyHandoffTemplate : null,
    vpnModuleEnabled: Boolean(data.vpnModuleEnabled),
  };
}
