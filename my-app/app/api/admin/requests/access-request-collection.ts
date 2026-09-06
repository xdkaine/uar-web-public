import { Prisma } from '@prisma/client';

import {
  CollectionQueryError,
  collectionFingerprint,
  decodeCollectionCursor,
  parseCollectionDirection,
  parseCollectionLimit,
  parseCollectionSort,
  type CollectionDirection,
} from '@/lib/admin/collections';
import { WORKFLOW_STAGE_CATALOG, type WorkflowStageKey } from '@/lib/workflow/schema';

const REQUEST_SORTS = ['createdAt', 'name', 'email', 'status'] as const;
const REQUEST_STATUSES = new Set(['pending_verification', 'pending_student_directors', 'pending_faculty', 'approved', 'rejected', 'offboarded']);

export type AccessRequestCollectionQuery = {
  search: string; status: string | null; type: 'internal' | 'external' | null; verification: 'verified' | 'unverified' | null; eventId: string | null; event: string | null; workflowVersionId: string | null; stageKey: WorkflowStageKey | null;
  sort: typeof REQUEST_SORTS[number]; direction: CollectionDirection; limit: number; cursor: { value: string; id: string } | null; fingerprint: string;
};

export function parseAccessRequestCollectionQuery(params: URLSearchParams): AccessRequestCollectionQuery {
  const status = params.get('status');
  const type = params.get('type');
  const verification = params.get('verification');
  const workflowVersionId = params.get('workflowVersionId');
  const stageKey = params.get('stageKey');
  if (status !== null && !REQUEST_STATUSES.has(status)) throw new CollectionQueryError('status is not supported');
  if (type !== null && type !== 'internal' && type !== 'external') throw new CollectionQueryError('type is not supported');
  if (verification !== null && verification !== 'verified' && verification !== 'unverified') throw new CollectionQueryError('verification is not supported');
  if (stageKey !== null && !Object.prototype.hasOwnProperty.call(WORKFLOW_STAGE_CATALOG, stageKey)) throw new CollectionQueryError('stageKey is not supported');
  if ((workflowVersionId === null) !== (stageKey === null)) throw new CollectionQueryError('workflowVersionId and stageKey must be supplied together');
  const search = (params.get('search') || '').trim().slice(0, 120);
  const sort = parseCollectionSort(params.get('sort'), REQUEST_SORTS, 'createdAt');
  const direction = parseCollectionDirection(params.get('direction'));
  const eventId = params.get('eventId');
  const event = params.get('event');
  const fingerprint = collectionFingerprint({ search, status, type, verification, eventId, event, workflowVersionId, stageKey, sort, direction });
  const cursor = decodeCollectionCursor(params.get('cursor'), fingerprint);
  if (cursor && sort === 'createdAt' && Number.isNaN(Date.parse(cursor.value))) throw new CollectionQueryError('cursor contains an invalid createdAt value');
  return { search, status, type: type as AccessRequestCollectionQuery['type'], verification: verification as AccessRequestCollectionQuery['verification'], eventId, event, workflowVersionId, stageKey: stageKey as WorkflowStageKey | null, sort, direction, limit: parseCollectionLimit(params.get('limit')), cursor, fingerprint };
}

export function accessRequestWhere(query: AccessRequestCollectionQuery): Prisma.AccessRequestWhereInput {
  const filters: Prisma.AccessRequestWhereInput[] = [];
  if (query.status) filters.push({ status: query.status });
  if (query.type) filters.push({ isInternal: query.type === 'internal' });
  if (query.verification) filters.push({ isVerified: query.verification === 'verified' });
  if (query.eventId) filters.push({ eventId: query.eventId });
  if (query.event) filters.push({ OR: [{ event: { name: query.event } }, { eventReason: query.event }] });
  if (query.stageKey && query.workflowVersionId) {
    filters.push({
      status: WORKFLOW_STAGE_CATALOG[query.stageKey].status,
      workflowVersionId: query.workflowVersionId === 'legacy' ? null : query.workflowVersionId,
    });
  }
  if (query.search) filters.push({ OR: [
    { name: { contains: query.search, mode: 'insensitive' } }, { email: { contains: query.search, mode: 'insensitive' } },
    { institution: { contains: query.search, mode: 'insensitive' } }, { eventReason: { contains: query.search, mode: 'insensitive' } },
    { event: { name: { contains: query.search, mode: 'insensitive' } } },
  ] });
  if (query.cursor) {
    const value = query.sort === 'createdAt' ? new Date(query.cursor.value) : query.cursor.value;
    const comparator = query.direction === 'asc' ? 'gt' : 'lt';
    filters.push({ OR: [{ [query.sort]: { [comparator]: value } }, { [query.sort]: value, id: { [comparator]: query.cursor.id } }] } as Prisma.AccessRequestWhereInput);
  }
  return filters.length ? { AND: filters } : {};
}
