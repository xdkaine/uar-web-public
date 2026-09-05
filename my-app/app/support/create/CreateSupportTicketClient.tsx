'use client';

import { useEffect, useMemo, useReducer, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as m from 'framer-motion/m';
import { ArrowLeft, Info, Loader2, Send } from 'lucide-react';
import PortalPageHeading from '@/components/appearance/PortalPageHeading';
import { htmlToPlainText, isEmptyRichText } from '@/lib/ticket-content';
import { fetchWithCsrf } from '@/lib/csrf';
import { formatGroupPath, type GroupDisplayInfo } from '@/lib/support/group-display';
import { getTicketFormFields, missingRequiredFieldKeys, type TicketFormValues } from '@/lib/support/ticket-form-schema';
import { isGroupJoinCategory, TICKET_CATEGORIES } from '@/lib/support/ticket-categories';
import { validateStagedEvidenceFiles } from '@/components/support/TicketEvidence.shared';
import { TicketTopicPane } from './CreateTicketTopicPane';
import { TicketDetailsPane } from './CreateTicketDetailsPane';
import { TicketReviewPane } from './CreateTicketReviewPane';
import type { AccountIntent, TicketDraft } from './CreateTicketTypes';

export interface AccessRequest { id: string; name: string; email: string; status: string; isInternal: boolean; createdAt: string; }
export interface AllowedGroup extends GroupDisplayInfo { name: string; }
interface Props { requestId: string | null; initialRelatedRequest: AccessRequest | null; allowedGroups: AllowedGroup[]; joinableGroups: AllowedGroup[]; joinWorkflowAvailable: boolean; }
interface SubmissionState { activeRequestId: string | null; error: string; loading: boolean; }
type SubmissionAction = { type: 'started'; requestId: string } | { type: 'failed'; requestId: string; message: string } | { type: 'finished'; requestId: string };

function submissionReducer(state: SubmissionState, action: SubmissionAction): SubmissionState {
  if (action.type === 'started') return { activeRequestId: action.requestId, error: '', loading: true };
  if (state.activeRequestId !== action.requestId) return state;
  return action.type === 'failed' ? { ...state, error: action.message } : { ...state, loading: false };
}
function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function makeDraft(requestId: string | null, request: AccessRequest | null): TicketDraft {
  const narrative = request ? `<p>I need assistance with my access request:</p><p>Request ID: ${escapeHtml(requestId ?? '')}<br>Name: ${escapeHtml(request.name)}<br>Email: ${escapeHtml(request.email)}<br>Status: ${escapeHtml(request.status)}</p><p>Issue:</p>` : '';
  return { subject: request ? `Issue with Access Request - ${request.name}` : '', category: request ? 'ACCOUNT' : '', severity: '', narrative, relatedRequestId: requestId ?? '', requestedForGroupDn: '', joinGroupDn: '' };
}

export default function CreateSupportTicketClient({ requestId, initialRelatedRequest, allowedGroups, joinableGroups, joinWorkflowAvailable }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => makeDraft(requestId, initialRelatedRequest));
  const [accountIntent, setAccountIntent] = useState<AccountIntent>('problem');
  const [subjectTouched, setSubjectTouched] = useState(Boolean(initialRelatedRequest));
  const [values, setValues] = useState<TicketFormValues>({});
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
  const [evidenceError, setEvidenceError] = useState('');
  const [submission, dispatch] = useReducer(submissionReducer, { activeRequestId: null, error: '', loading: false });
  const isAccount = draft.category === 'ACCOUNT';
  const canOfferGroupJoin = isAccount && joinableGroups.length > 0;
  const wantsGroupJoin = canOfferGroupJoin && accountIntent === 'join_group';
  const selectedTopic = useMemo(() => TICKET_CATEGORIES.find((option) => option.value === draft.category) ?? null, [draft.category]);
  const selectedJoinGroup = useMemo(() => joinableGroups.find((group) => group.dn === draft.joinGroupDn) ?? null, [draft.joinGroupDn, joinableGroups]);
  const selectedForGroup = useMemo(() => allowedGroups.find((group) => group.dn === draft.requestedForGroupDn) ?? null, [allowedGroups, draft.requestedForGroupDn]);
  const formFields = useMemo(() => getTicketFormFields({ category: draft.category, accountIntent }), [accountIntent, draft.category]);
  const missingFieldKeys = useMemo(() => missingRequiredFieldKeys(formFields, values), [formFields, values]);
  const missingFieldKeySet = useMemo(() => new Set(missingFieldKeys), [missingFieldKeys]);
  const composedBodyHtml = useMemo(() => `${formFields.flatMap((field) => { const value = (values[field.key] ?? '').trim(); if (!value) return []; const display = field.kind === 'select' ? field.options?.find((option) => option.value === value)?.label ?? value : value; return [`<p><strong>${escapeHtml(field.label.replace(/\?$/, ''))}:</strong> ${escapeHtml(display)}</p>`]; }).join('')}${draft.narrative.trim()}`, [draft.narrative, formFields, values]);
  const canSubmit = Boolean(draft.category && draft.subject.trim() && missingFieldKeys.length === 0 && (!wantsGroupJoin || draft.joinGroupDn) && (!isEmptyRichText(draft.narrative) || Object.values(values).some((value) => value.trim())) && !submission.loading);
  const joinOptions = useMemo(() => joinableGroups.map((group) => ({ value: group.dn, label: group.displayName, meta: group.path.length ? formatGroupPath(group.path) : undefined, keywords: [group.name, group.containerName ?? ''] })), [joinableGroups]);
  const filedForOptions = useMemo(() => allowedGroups.map((group) => ({ value: group.dn, label: group.displayName, meta: group.path.length ? formatGroupPath(group.path) : undefined, keywords: [group.name, group.containerName ?? ''] })), [allowedGroups]);
  useEffect(() => { if (subjectTouched) return; const suggestion = wantsGroupJoin ? selectedJoinGroup ? `Group membership request - ${selectedJoinGroup.displayName}` : 'Group membership request' : selectedTopic?.label ?? ''; setDraft((current) => ({ ...current, subject: suggestion })); }, [selectedJoinGroup, selectedTopic, subjectTouched, wantsGroupJoin]);
  const updateCategory = (category: string) => { setValues({}); setDraft((current) => ({ ...current, category, joinGroupDn: isGroupJoinCategory(category) ? current.joinGroupDn : '' })); if (!isGroupJoinCategory(category)) setAccountIntent('problem'); };
  const toggleSeverity = (severity: string) => setDraft((current) => ({ ...current, severity: current.severity === severity ? '' : severity }));
  const addPastedEvidence = (files: File[]) => { if (!files.length) return; const result = validateStagedEvidenceFiles(files, stagedFiles.length); if (result.error) return setEvidenceError(result.error); setEvidenceError(''); setStagedFiles((current) => [...current, ...result.accepted]); };
  const submit = async () => {
    if (!canSubmit) return;
    const currentRequestId = crypto.randomUUID();
    dispatch({ type: 'started', requestId: currentRequestId });
    try {
      const response = await fetchWithCsrf('/api/support/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subject: draft.subject, category: draft.category, severity: draft.severity, descriptionHtml: composedBodyHtml, relatedRequestId: draft.relatedRequestId, requestedForGroupDn: draft.requestedForGroupDn, joinGroupDn: wantsGroupJoin ? draft.joinGroupDn : '' }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Failed to submit support ticket');
      const evidenceFailed = await uploadEvidence(body.ticketId, stagedFiles);
      router.push(`/support/tickets/${body.ticketId}${evidenceFailed ? '?evidenceFailed=1' : ''}`);
    } catch (error) { dispatch({ type: 'failed', requestId: currentRequestId, message: error instanceof Error ? error.message : 'An error occurred. Please try again.' }); }
    finally { dispatch({ type: 'finished', requestId: currentRequestId }); }
  };
  return <CreateTicketPage draft={draft} setDraft={setDraft} accountIntent={accountIntent} setAccountIntent={setAccountIntent} allowedGroups={allowedGroups} isAccount={isAccount} canOfferGroupJoin={canOfferGroupJoin} wantsGroupJoin={wantsGroupJoin} joinOptions={joinOptions} filedForOptions={filedForOptions} updateCategory={updateCategory} subjectTouched={subjectTouched} setSubjectTouched={setSubjectTouched} formFields={formFields} values={values} setValues={setValues} missingFieldKeySet={missingFieldKeySet} selectedTopic={selectedTopic} joinWorkflowAvailable={joinWorkflowAvailable} toggleSeverity={toggleSeverity} addPastedEvidence={addPastedEvidence} selectedForGroup={selectedForGroup} selectedJoinGroup={selectedJoinGroup} composedBodyHtml={composedBodyHtml} evidenceError={evidenceError} stagedFiles={stagedFiles} setStagedFiles={setStagedFiles} setEvidenceError={setEvidenceError} canSubmit={canSubmit} loading={submission.loading} error={submission.error} relatedRequest={initialRelatedRequest} onBack={() => router.push('/support/tickets')} onSubmit={submit} />;
}

async function uploadEvidence(ticketId: string, files: File[]): Promise<boolean> {
  if (!files.length) return false;
  const form = new FormData(); files.forEach((file) => form.append('files', file));
  try { return !(await fetchWithCsrf(`/api/support/tickets/${ticketId}/attachments`, { method: 'POST', body: form })).ok; } catch { return true; }
}

function CreateTicketPage(props: Omit<React.ComponentProps<typeof TicketTopicPane>, 'setDraft' | 'setAccountIntent' | 'draft'> & { draft: TicketDraft; setDraft: React.Dispatch<React.SetStateAction<TicketDraft>>; accountIntent: AccountIntent; setAccountIntent: React.Dispatch<React.SetStateAction<AccountIntent>>; subjectTouched: boolean; setSubjectTouched: React.Dispatch<React.SetStateAction<boolean>>; formFields: ReturnType<typeof getTicketFormFields>; values: TicketFormValues; setValues: React.Dispatch<React.SetStateAction<TicketFormValues>>; missingFieldKeySet: Set<string>; wantsGroupJoin: boolean; selectedTopic: { value: string; label: string } | null; joinWorkflowAvailable: boolean; toggleSeverity: (value: string) => void; addPastedEvidence: (files: File[]) => void; selectedForGroup: AllowedGroup | null; selectedJoinGroup: AllowedGroup | null; composedBodyHtml: string; evidenceError: string; stagedFiles: File[]; setStagedFiles: React.Dispatch<React.SetStateAction<File[]>>; setEvidenceError: React.Dispatch<React.SetStateAction<string>>; canSubmit: boolean; loading: boolean; error: string; relatedRequest: AccessRequest | null; onBack: () => void; onSubmit: () => void }) {
  return <div className="min-h-screen bg-background"><div className="border-b border-border bg-card/60"><div className="px-4 py-5 sm:px-6 lg:px-10"><m.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="flex flex-wrap items-center justify-between gap-4"><div className="flex items-center gap-4"><button onClick={props.onBack} aria-label="Back to My Tickets" className="rounded-lg border border-border bg-card p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"><ArrowLeft className="h-4 w-4" /></button><PortalPageHeading page="supportCreate" /></div><button type="button" onClick={props.onSubmit} disabled={!props.canSubmit} className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">{props.loading ? <><Loader2 className="h-4 w-4 animate-spin" />Submitting…</> : <><Send className="h-4 w-4" />Submit ticket</>}</button></m.div></div></div><div className="px-4 py-8 sm:px-6 lg:px-10">{props.error && <div className="mb-6 rounded-lg border border-destructive/40 bg-destructive/10 p-4"><p className="text-sm text-destructive">{props.error}</p></div>}{props.relatedRequest && <div className="mb-6 flex items-start gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-4"><Info className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" /><div><h3 className="text-sm font-semibold text-blue-900 dark:text-blue-200">Linked access request</h3><p className="text-sm text-blue-800 dark:text-blue-300">{props.relatedRequest.name} · {props.relatedRequest.email} · status {props.relatedRequest.status}</p></div></div>}<div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)] xl:grid-cols-[320px_minmax(0,1fr)_360px]"><TicketTopicPane draft={props.draft} allowedGroups={props.allowedGroups} isAccount={props.isAccount} canOfferGroupJoin={props.canOfferGroupJoin} accountIntent={props.accountIntent} joinOptions={props.joinOptions} filedForOptions={props.filedForOptions} updateCategory={props.updateCategory} setDraft={props.setDraft} setAccountIntent={props.setAccountIntent} /><TicketDetailsPane draft={props.draft} setDraft={props.setDraft} subjectTouched={props.subjectTouched} setSubjectTouched={props.setSubjectTouched} formFields={props.formFields} values={props.values} setValues={props.setValues} missingFieldKeySet={props.missingFieldKeySet} wantsGroupJoin={props.wantsGroupJoin} selectedTopic={props.selectedTopic} joinWorkflowAvailable={props.joinWorkflowAvailable} toggleSeverity={props.toggleSeverity} onImageFiles={props.addPastedEvidence} /><TicketReviewPane draft={props.draft} selectedTopic={props.selectedTopic} selectedForGroup={props.selectedForGroup} selectedJoinGroup={props.selectedJoinGroup} wantsGroupJoin={props.wantsGroupJoin} composedBodyHtml={props.composedBodyHtml} htmlToPlainText={htmlToPlainText} evidenceError={props.evidenceError} stagedFiles={props.stagedFiles} setStagedFiles={props.setStagedFiles} setEvidenceError={props.setEvidenceError} canSubmit={props.canSubmit} loading={props.loading} onSubmit={props.onSubmit} /></div></div></div>;
}
