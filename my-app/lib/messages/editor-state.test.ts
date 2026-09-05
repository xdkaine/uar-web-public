import { describe, expect, it } from 'vitest';

import {
  cacheCurrentMessagePreview,
  claimMessagePreviewRequest,
  isCurrentMessagePreviewRequest,
  isBasicMessageEditorRoundTripSafe,
  isMessageTemplateDraftDirty,
  mergeMessageDraftValues,
  messageEditorInstanceKey,
  messagePreviewCacheKey,
  resolveMessageEditorCss,
  resolveMessagePreviewPlan,
} from './editor-state';

describe('message template editor state', () => {
  it('compares the draft with the exact saved source', () => {
    expect(
      isMessageTemplateDraftDirty({
        subjectOnly: false,
        savedSubject: 'Welcome',
        draftSubject: 'Welcome',
        savedBody: '<p>Hello</p>',
        draftBody: '<p>Hello</p>',
      }),
    ).toBe(false);
  });

  it('still detects a real body edit', () => {
    expect(
      isMessageTemplateDraftDirty({
        subjectOnly: false,
        savedSubject: null,
        draftSubject: '',
        savedBody: '<p>Hello</p>',
        draftBody: '<p>Hello there</p>',
      }),
    ).toBe(true);
  });

  it('rejects the lossy Basic-editor conversion shown by the rejection email', () => {
    const saved = [
      '<div style="font-family: Arial, sans-serif; max-width: 600px;">',
      '<div style="background-color: #fee; padding: 16px;">',
      '<p style="color: #c33; font-weight: bold;">Reason:</p>',
      '<p>{{reason}}</p>',
      '</div>',
      '</div>',
    ].join('');
    const basic = '<p><strong>Reason:</strong></p><p>{{reason}}</p>';

    expect(isBasicMessageEditorRoundTripSafe(saved, basic)).toBe(false);
  });

  it('treats formatting-only whitespace changes as a lossy round trip', () => {
    expect(
      isBasicMessageEditorRoundTripSafe(
        '<p>Hello</p>\n  <p>{{name}}</p>',
        '<p>Hello</p><p>{{name}}</p>',
      ),
    ).toBe(false);
  });

  it('refreshes only the acted-on template while preserving other in-memory edits', () => {
    const fresh = { alpha: 'saved alpha', beta: 'saved beta' };
    const current = { alpha: 'edited alpha', beta: 'edited beta' };

    expect(mergeMessageDraftValues(fresh, current, new Set(['alpha']))).toEqual({
      alpha: 'saved alpha',
      beta: 'edited beta',
    });
    expect(mergeMessageDraftValues(fresh, current, new Set())).toEqual(current);
    expect(mergeMessageDraftValues(fresh, current)).toEqual(fresh);
  });

  it('remounts the editor when a restore creates a new draft identity', () => {
    const base = {
      key: 'faculty.handoff_message',
      mode: 'document',
      draftUpdatedAt: '2026-08-28T10:00:00.000Z',
      publishedUpdatedAt: '2026-08-28T09:00:00.000Z',
    };

    expect(messageEditorInstanceKey({ ...base, draftVersion: 3 }))
      .not.toBe(messageEditorInstanceKey({ ...base, draftVersion: 4 }));
  });

  it('treats CSS as part of preview cache identity', () => {
    const base = { key: 'request.rejection_notice', mode: 'draft', body: '<p>Hello</p>' };
    expect(messagePreviewCacheKey({ ...base, css: 'p { color: red; }' }))
      .not.toBe(messagePreviewCacheKey({ ...base, css: 'p { color: blue; }' }));
  });

  it('falls back from draft CSS to the published template CSS', () => {
    expect(resolveMessageEditorCss({ draftCss: null, publishedCss: '.published {}', templateCss: '.stored {}' }))
      .toBe('.published {}');
    expect(resolveMessageEditorCss({ templateCss: '.stored {}' })).toBe('.stored {}');
  });

  it('always compares the saved revision with the live working copy', () => {
    expect(resolveMessagePreviewPlan({ compareMode: true, previewMode: 'saved' })).toEqual(['saved', 'draft']);
    expect(resolveMessagePreviewPlan({ compareMode: true, previewMode: 'default' })).toEqual(['saved', 'draft']);
    expect(resolveMessagePreviewPlan({ compareMode: false, previewMode: 'default' })).toEqual(['default']);
  });

  it('rejects stale and invalidated preview responses', () => {
    const requests = new Map<string, string>();
    const cache = new Map<string, string>();
    claimMessagePreviewRequest(requests, 'template:draft', 'request-1');
    claimMessagePreviewRequest(requests, 'template:draft', 'request-2');

    expect(isCurrentMessagePreviewRequest(requests, 'template:draft', 'request-1')).toBe(false);
    expect(isCurrentMessagePreviewRequest(requests, 'template:draft', 'request-2')).toBe(true);
    requests.clear();
    claimMessagePreviewRequest(requests, 'template:draft', 'request-3');
    expect(isCurrentMessagePreviewRequest(requests, 'template:draft', 'request-2')).toBe(false);
    expect(isCurrentMessagePreviewRequest(requests, 'template:draft', 'request-3')).toBe(true);
    expect(cacheCurrentMessagePreview({
      requests,
      cache,
      slot: 'template:draft',
      requestToken: 'request-2',
      payloadKey: 'same-payload',
      content: 'stale response',
    })).toBe(false);
    expect(cache.has('same-payload')).toBe(false);
  });
});
