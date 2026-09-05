import type { ConditionComparisonOp } from '@/lib/flow/catalog';

export interface NodeConfigField {
  name: string;
  label: string;
  kind: 'string' | 'number' | 'text' | 'select' | 'boolean' | 'group-dn' | 'group-dns' | 'monitor-checks';
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  help?: string;
}

export interface CatalogEntry {
  type: string;
  category: 'source' | 'trigger' | 'logic' | 'action';
  label: string;
  description: string;
  handles?: Array<{ id: string; label: string }>;
  configSchema: NodeConfigField[];
  contextFields?: Array<{ key: string; label: string }>;
}

export interface ConditionComparisonDraft {
  field: string;
  op: ConditionComparisonOp;
  value: string | string[];
}

export interface ConditionGroupDraft {
  match: 'all' | 'any';
  comparisons: ConditionComparisonDraft[];
}

export interface StoredGraph {
  id: string;
  name: string;
  description: string | null;
  triggerKey: string;
  nodes: unknown;
  edges: unknown;
  status: string;
  version: number;
  enabled: boolean;
  updatedAt: string;
  runCount?: number;
}

export interface StoredRun {
  id: string;
  eventKey: string;
  status: string;
  error: string | null;
  startedAt: string;
  nodeOutcomes?: Array<{ nodeId: string; status: string; error?: string | null }> | null;
}

export interface MonitorCredentialOption {
  id: string;
  name: string;
  kind: string;
  allowedHosts: string[];
  enabled: boolean;
}

export interface MonitorCredentialDraft {
  name: string;
  kind: string;
  username: string;
  headerName: string;
  secret: string;
  hosts: string;
}

export interface MonitorCheckDraft {
  key: string;
  name: string;
  kind: 'http' | 'https' | 'tcp' | 'tls' | 'ldaps' | 'icmp';
  host: string;
  port?: number;
  path?: string;
  method?: 'GET' | 'HEAD';
  expectedStatusMin?: number;
  expectedStatusMax?: number;
  expectedBody?: string;
  baseDn?: string;
  credentialRef?: string;
  legacyEndpointId?: string;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  enabled: boolean;
}
