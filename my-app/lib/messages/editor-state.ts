interface MessageTemplateDraftState {
  subjectOnly: boolean;
  savedSubject: string | null;
  draftSubject: string;
  savedBody: string;
  draftBody: string;
}

export function isMessageTemplateDraftDirty(state: MessageTemplateDraftState): boolean {
  const subjectEditable = state.subjectOnly || state.savedSubject !== null;
  const subjectDirty = subjectEditable && state.draftSubject !== (state.savedSubject ?? '');
  const bodyDirty = !state.subjectOnly && state.draftBody !== state.savedBody;
  return subjectDirty || bodyDirty;
}

export function isBasicMessageEditorRoundTripSafe(source: string, basicHtml: string): boolean {
  return source === basicHtml;
}

export function mergeMessageDraftValues(
  fresh: Record<string, string>,
  current: Record<string, string>,
  replaceKeys?: ReadonlySet<string>,
): Record<string, string> {
  if (replaceKeys === undefined) return fresh;

  return Object.fromEntries(
    Object.entries(fresh).map(([key, value]) => [
      key,
      !replaceKeys.has(key) && Object.hasOwn(current, key) ? current[key] : value,
    ]),
  );
}

export function messageEditorInstanceKey(input: {
  key: string;
  mode: string;
  draftVersion: number | null;
  draftUpdatedAt: string | null;
  publishedUpdatedAt: string | null;
}): string {
  return JSON.stringify([
    input.key,
    input.mode,
    input.draftVersion,
    input.draftUpdatedAt,
    input.publishedUpdatedAt,
  ]);
}

export function messagePreviewCacheKey(input: {
  key: string;
  mode: string;
  subject?: string;
  body?: string;
  css?: string;
}): string {
  return JSON.stringify([
    input.key,
    input.mode,
    input.subject ?? null,
    input.body ?? null,
    input.css ?? null,
  ]);
}

export function resolveMessageEditorCss(input: {
  draftCss?: string | null;
  publishedCss?: string | null;
  templateCss?: string | null;
}): string {
  return input.draftCss ?? input.publishedCss ?? input.templateCss ?? '';
}

export type MessagePreviewSource = 'draft' | 'saved' | 'default';

export function resolveMessagePreviewPlan(input: {
  compareMode: boolean;
  previewMode: MessagePreviewSource;
}): MessagePreviewSource[] {
  return input.compareMode ? ['saved', 'draft'] : [input.previewMode];
}

export function claimMessagePreviewRequest(
  requests: Map<string, string>,
  slot: string,
  requestToken: string,
): void {
  requests.set(slot, requestToken);
}

export function isCurrentMessagePreviewRequest(
  requests: ReadonlyMap<string, string>,
  slot: string,
  requestToken: string,
): boolean {
  return requests.get(slot) === requestToken;
}

export function cacheCurrentMessagePreview<T>(input: {
  requests: ReadonlyMap<string, string>;
  cache: Map<string, T>;
  slot: string;
  requestToken: string;
  payloadKey: string;
  content: T;
}): boolean {
  if (!isCurrentMessagePreviewRequest(input.requests, input.slot, input.requestToken)) {
    return false;
  }
  input.cache.set(input.payloadKey, input.content);
  return true;
}
