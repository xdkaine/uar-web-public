'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type SetStateAction } from 'react';
import { requestActionImpact } from '@/components/admin/actionImpactRequest';
import { fetchWithCsrf } from '@/lib/csrf';
import { MESSAGE_TEMPLATE_CATALOG } from '@/lib/messages/catalog';
import {
  cacheCurrentMessagePreview,
  claimMessagePreviewRequest,
  isCurrentMessagePreviewRequest,
  isMessageTemplateDraftDirty,
  mergeMessageDraftValues,
  messagePreviewCacheKey,
  resolveMessagePreviewPlan,
} from '@/lib/messages/editor-state';
import type {
  AuthorMode,
  MessageRevision,
  MessageTemplate,
  PanelMessage,
  PreviewContent,
  PreviewMode,
  PreviewSurface,
} from './message-panel-types';

interface MessageTemplatesResponse {
  templates?: MessageTemplate[];
  revisions?: MessageRevision[];
}

interface MessageDataState {
  templates: MessageTemplate[];
  revisions: MessageRevision[];
  bodyDrafts: Record<string, string>;
  subjectDrafts: Record<string, string>;
  cssDrafts: Record<string, string>;
  selectedKey: string | null;
  loading: boolean;
}

type MessageDataAction =
  | { type: 'loaded'; templates: MessageTemplate[]; revisions: MessageRevision[]; replaceDraftKeys?: ReadonlySet<string> }
  | { type: 'loadFailed' }
  | { type: 'bodyDrafts'; value: SetStateAction<Record<string, string>> }
  | { type: 'subjectDrafts'; value: SetStateAction<Record<string, string>> }
  | { type: 'cssDrafts'; value: SetStateAction<Record<string, string>> }
  | { type: 'selectedKey'; value: SetStateAction<string | null> };

const INITIAL_MESSAGE_DATA: MessageDataState = {
  templates: [], revisions: [], bodyDrafts: {}, subjectDrafts: {}, cssDrafts: {}, selectedKey: null, loading: true,
};

function resolveStateAction<T>(value: SetStateAction<T>, current: T): T {
  return typeof value === 'function' ? (value as (previous: T) => T)(current) : value;
}

function messageDataReducer(state: MessageDataState, action: MessageDataAction): MessageDataState {
  if (action.type === 'loaded') {
    const bodies = Object.fromEntries(action.templates.map((template) => [template.key, template.body]));
    const subjects = Object.fromEntries(action.templates.map((template) => [template.key, template.subject ?? '']));
    const css = Object.fromEntries(action.templates.map((template) => [template.key, template.css ?? '']));
    return {
      templates: action.templates,
      revisions: action.revisions,
      bodyDrafts: mergeMessageDraftValues(bodies, state.bodyDrafts, action.replaceDraftKeys),
      subjectDrafts: mergeMessageDraftValues(subjects, state.subjectDrafts, action.replaceDraftKeys),
      cssDrafts: mergeMessageDraftValues(css, state.cssDrafts, action.replaceDraftKeys),
      selectedKey: state.selectedKey ?? action.templates[0]?.key ?? null,
      loading: false,
    };
  }
  if (action.type === 'loadFailed') return { ...state, loading: false };
  if (action.type === 'bodyDrafts') return { ...state, bodyDrafts: resolveStateAction(action.value, state.bodyDrafts) };
  if (action.type === 'subjectDrafts') return { ...state, subjectDrafts: resolveStateAction(action.value, state.subjectDrafts) };
  if (action.type === 'cssDrafts') return { ...state, cssDrafts: resolveStateAction(action.value, state.cssDrafts) };
  return { ...state, selectedKey: resolveStateAction(action.value, state.selectedKey) };
}

export function useMessageTemplates() {
  const [messageData, dispatchMessageData] = useReducer(messageDataReducer, INITIAL_MESSAGE_DATA);
  const { templates, revisions, bodyDrafts, subjectDrafts, cssDrafts, selectedKey, loading } = messageData;
  const setBodyDrafts = (value: SetStateAction<Record<string, string>>) => dispatchMessageData({ type: 'bodyDrafts', value });
  const setSubjectDrafts = (value: SetStateAction<Record<string, string>>) => dispatchMessageData({ type: 'subjectDrafts', value });
  const setCssDrafts = (value: SetStateAction<Record<string, string>>) => dispatchMessageData({ type: 'cssDrafts', value });
  const setSelectedKey = (value: SetStateAction<string | null>) => dispatchMessageData({ type: 'selectedKey', value });
  const [authorMode, setAuthorMode] = useState<AuthorMode>('blocks');
  const [previewSurface, setPreviewSurface] = useState<PreviewSurface>('desktop');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());
  const [previewMode, setPreviewMode] = useState<PreviewMode>('draft');
  const [compareMode, setCompareMode] = useState(false);
  const [previews, setPreviews] = useState<Record<string, PreviewContent>>({});
  const [previewLoading, setPreviewLoading] = useState(false);
  const [copiedVariable, setCopiedVariable] = useState<string | null>(null);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testRecipientMode, setTestRecipientMode] = useState<'self' | 'specific'>('self');
  const [testRecipient, setTestRecipient] = useState('');
  const previewCache = useRef(new Map<string, PreviewContent>());
  const latestPreviewRequests = useRef(new Map<string, string>());
  const previewRequestsInFlight = useRef(0);
  const previewRequestSequence = useRef(0);

  const fetchTemplates = useCallback(async (replaceDraftKeys?: ReadonlySet<string>) => {
    try {
      const response = await fetch('/api/admin/config/messages');
      if (!response.ok) throw new Error('Failed to load message templates');
      const data = await response.json() as MessageTemplatesResponse;
      const list = data.templates ?? [];
      dispatchMessageData({ type: 'loaded', templates: list, revisions: data.revisions ?? [], replaceDraftKeys });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load' });
    } finally {
      dispatchMessageData({ type: 'loadFailed' });
    }
  }, []);

  useEffect(() => {
    void fetchTemplates();
  }, [fetchTemplates]);

  const templateByKey = useMemo(() => new Map(templates.map((template) => [template.key, template])), [templates]);
  const selected = selectedKey ? templateByKey.get(selectedKey) ?? null : null;
  const isDirty = useCallback((template: MessageTemplate) => (
    isMessageTemplateDraftDirty({
      subjectOnly: template.subjectOnly,
      savedSubject: template.subject,
      draftSubject: subjectDrafts[template.key] ?? '',
      savedBody: template.body,
      draftBody: bodyDrafts[template.key] ?? '',
    }) || (cssDrafts[template.key] ?? '') !== (template.css ?? '')
  ), [bodyDrafts, cssDrafts, subjectDrafts]);

  const requestPreview = useCallback(async (template: MessageTemplate, mode: PreviewMode, drafts: { subject?: string; body?: string; css?: string }) => {
    const payloadKey = messagePreviewCacheKey({ key: template.key, mode, ...drafts });
    const previewSlot = `${template.key}:${mode}`;
    const requestToken = `${previewSlot}:${++previewRequestSequence.current}`;
    claimMessagePreviewRequest(latestPreviewRequests.current, previewSlot, requestToken);
    const cached = previewCache.current.get(payloadKey);
    if (cached) {
      if (isCurrentMessagePreviewRequest(latestPreviewRequests.current, previewSlot, requestToken)) setPreviews((previous) => ({ ...previous, [previewSlot]: cached }));
      return;
    }
    previewRequestsInFlight.current += 1;
    setPreviewLoading(true);
    try {
      const response = await fetchWithCsrf('/api/admin/config/messages/preview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: template.key, ...drafts }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to render preview');
      const content: PreviewContent = { subject: result.subject ?? '', html: result.html ?? '', text: result.text ?? '', diagnostics: result.diagnostics ?? [] };
      if (cacheCurrentMessagePreview({ requests: latestPreviewRequests.current, cache: previewCache.current, slot: previewSlot, requestToken, payloadKey, content })) setPreviews((previous) => ({ ...previous, [previewSlot]: content }));
    } catch {
      if (isCurrentMessagePreviewRequest(latestPreviewRequests.current, previewSlot, requestToken)) setPreviews((previous) => ({ ...previous, [previewSlot]: { subject: '', html: '<p style="color:#b91c1c;">Preview failed to render.</p>' } }));
    } finally {
      previewRequestsInFlight.current = Math.max(0, previewRequestsInFlight.current - 1);
      setPreviewLoading(previewRequestsInFlight.current > 0);
    }
  }, []);

  useEffect(() => {
    if (!selected) return;
    const timer = setTimeout(() => {
      const definition = MESSAGE_TEMPLATE_CATALOG[selected.key];
      for (const mode of resolveMessagePreviewPlan({ compareMode, previewMode })) {
        const drafts = mode === 'draft'
          ? { subject: subjectDrafts[selected.key], body: selected.subjectOnly ? undefined : bodyDrafts[selected.key], css: selected.subjectOnly ? undefined : cssDrafts[selected.key] }
          : mode === 'default'
            ? { css: '', ...(definition?.defaultSubject !== undefined ? { subject: definition.defaultSubject } : {}), ...(definition?.defaultBody !== undefined && !selected.subjectOnly ? { body: definition.defaultBody } : {}) }
            : {};
        void requestPreview(selected, mode, drafts);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [selected, previewMode, compareMode, subjectDrafts, bodyDrafts, cssDrafts, requestPreview]);

  const invalidatePreviewCache = useCallback(() => {
    previewCache.current.clear();
    latestPreviewRequests.current.clear();
    setPreviews({});
  }, []);

  const saveTemplate = async (template: MessageTemplate) => {
    setSavingKey(template.key); setMessage(null);
    try {
      const payload: Record<string, unknown> = { key: template.key, expectedPublishedVersion: template.publishedVersion };
      if (template.subjectOnly) payload.subject = subjectDrafts[template.key];
      else {
        payload.body = bodyDrafts[template.key]; payload.css = cssDrafts[template.key];
        if (template.subject !== null) payload.subject = subjectDrafts[template.key];
      }
      if (template.draftUpdatedAt) payload.expectedDraftUpdatedAt = template.draftUpdatedAt;
      const response = await fetchWithCsrf('/api/admin/config/messages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to save template');
      setMessage({ type: 'success', text: `Draft saved for "${template.label}".` });
      invalidatePreviewCache(); await fetchTemplates(new Set([template.key]));
    } catch (error) { setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save' }); }
    finally { setSavingKey(null); }
  };

  const runTemplateAction = async (template: MessageTemplate, action: 'publish' | 'test', testTarget?: { mode: 'self' | 'specific'; recipient?: string }) => {
    setSavingKey(template.key); setMessage(null);
    try {
      const payload = action === 'publish'
        ? { key: template.key, expectedDraftUpdatedAt: template.draftUpdatedAt }
        : { key: template.key, subject: subjectDrafts[template.key] ?? template.subject ?? template.label, body: template.subjectOnly ? '<p>Subject-only template test.</p>' : bodyDrafts[template.key] ?? '', css: cssDrafts[template.key] ?? '', expectedDraftUpdatedAt: template.draftUpdatedAt, expectedPublishedVersion: template.publishedVersion, recipientMode: testTarget?.mode ?? 'self', ...(testTarget?.mode === 'specific' ? { recipient: testTarget.recipient } : {}) };
      const response = await fetchWithCsrf(`/api/admin/config/messages/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Failed to ${action} template`);
      setMessage({ type: 'success', text: action === 'publish' ? `Published "${template.label}".` : `Test sent to ${result.recipient}.` });
      if (action === 'test') { setTestDialogOpen(false); setTestRecipientMode('self'); setTestRecipient(''); }
      invalidatePreviewCache(); await fetchTemplates(action === 'test' ? new Set() : new Set([template.key]));
    } catch (error) { setMessage({ type: 'error', text: error instanceof Error ? error.message : `Failed to ${action} template` }); }
    finally { setSavingKey(null); }
  };

  const resetToDefault = async (template: MessageTemplate) => {
    const definition = MESSAGE_TEMPLATE_CATALOG[template.key];
    if (!definition) return;
    const decision = await requestActionImpact({ title: 'Reset message draft', description: `Replace the unsaved editor content for "${template.label}" with the built-in default.`, items: [{ label: 'Live delivery', value: 'Unchanged until this draft is saved and published' }, { label: 'Unsaved editor', value: 'Replaced immediately', tone: 'warning' }], confirmLabel: 'Reset draft', destructive: true, evidence: 'Published revision history remains immutable.' });
    if (!decision.confirmed) return;
    setBodyDrafts((previous) => ({ ...previous, [template.key]: definition.defaultBody ?? '' }));
    setSubjectDrafts((previous) => ({ ...previous, [template.key]: definition.defaultSubject ?? '' }));
    setCssDrafts((previous) => ({ ...previous, [template.key]: '' }));
  };

  const restoreRevision = async (template: MessageTemplate, version: number | 'original') => {
    if (isDirty(template)) {
      const decision = await requestActionImpact({ title: 'Restore message revision', description: 'Restore this version as a new draft and discard the current unsaved editor changes.', items: [{ label: 'Source', value: version === 'original' ? 'Built-in original' : `Version ${version}` }, { label: 'Live delivery', value: 'Unchanged until the restored draft is published' }], confirmLabel: 'Restore as draft', destructive: true, evidence: 'Existing published and historical revisions remain immutable.' });
      if (!decision.confirmed) return;
    }
    setSavingKey(template.key); setMessage(null);
    try {
      const restoringOriginal = version === 'original';
      const concurrency = { expectedDraftUpdatedAt: template.draftUpdatedAt, expectedPublishedVersion: template.publishedVersion };
      const body = restoringOriginal ? { key: template.key, original: true, ...concurrency } : { key: template.key, version, ...concurrency };
      const response = await fetchWithCsrf('/api/admin/config/messages/restore', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Failed to restore message');
      setMessage({ type: 'success', text: `${restoringOriginal ? 'Built-in original' : `Version ${version}`} restored and saved as draft v${result.revision.version}. Publish when ready.` });
      await fetchTemplates(new Set([template.key]));
    } catch (error) { setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to restore message' }); }
    finally { setSavingKey(null); }
  };

  const copyVariable = async (name: string) => {
    try { await navigator.clipboard.writeText(`{{${name}}}`); setCopiedVariable(name); setTimeout(() => setCopiedVariable((current) => current === name ? null : current), 1500); }
    catch { /* Clipboard may be unavailable in an insecure context. */ }
  };

  return {
    templates, revisions, bodyDrafts, subjectDrafts, cssDrafts, authorMode, previewSurface, loading, savingKey, message, selectedKey, selected, collapsedCategories, previewMode, compareMode, previews, previewLoading, copiedVariable, testDialogOpen, testRecipientMode, testRecipient,
    setBodyDrafts, setSubjectDrafts, setCssDrafts, setAuthorMode, setPreviewSurface, setSelectedKey, setCollapsedCategories, setPreviewMode, setCompareMode, setTestDialogOpen, setTestRecipientMode, setTestRecipient,
    isDirty, saveTemplate, runTemplateAction, resetToDefault, restoreRevision, copyVariable,
  };
}
