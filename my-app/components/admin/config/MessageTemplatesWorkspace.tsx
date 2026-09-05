'use client';

import { Loader2 } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MessageTemplateEditor } from './MessageTemplateEditor';
import { MessageTemplateNavigator } from './MessageTemplateNavigator';
import { MessageTestDialog } from './MessageTestDialog';
import { useMessageTemplates } from './useMessageTemplates';

export function MessageTemplatesWorkspace() {
  const state = useMessageTemplates();
  if (state.loading) return <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  const totalDirty = state.templates.filter(state.isDirty).length;
  const selected = state.selected;
  return <div className="space-y-5">
    <MessageTestDialog open={state.testDialogOpen} template={selected} saving={state.savingKey !== null} recipientMode={state.testRecipientMode} recipient={state.testRecipient} onOpenChange={state.setTestDialogOpen} onRecipientMode={state.setTestRecipientMode} onRecipient={state.setTestRecipient} onSend={() => selected && void state.runTemplateAction(selected, 'test', { mode: state.testRecipientMode, recipient: state.testRecipient.trim() })} />
    {state.message && <Alert variant={state.message.type === 'error' ? 'destructive' : 'default'}><AlertDescription>{state.message.text}</AlertDescription></Alert>}
    <h3 className="text-sm font-medium text-muted-foreground">{state.templates.length} message templates · <span className={totalDirty > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : undefined}>{totalDirty} unsaved</span></h3>
    <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)]">
      <MessageTemplateNavigator templates={state.templates} selectedKey={state.selectedKey} collapsedCategories={state.collapsedCategories} isDirty={state.isDirty} onSelect={state.setSelectedKey} onToggleCategory={(category) => state.setCollapsedCategories((previous) => { const next = new Set(previous); if (next.has(category)) next.delete(category); else next.add(category); return next; })} />
      {selected ? <MessageTemplateEditor template={selected} revisions={state.revisions} bodyDraft={state.bodyDrafts[selected.key] ?? ''} subjectDraft={state.subjectDrafts[selected.key] ?? ''} cssDraft={state.cssDrafts[selected.key] ?? ''} authorMode={state.authorMode} previewSurface={state.previewSurface} previewMode={state.previewMode} compareMode={state.compareMode} previews={state.previews} previewLoading={state.previewLoading} copiedVariable={state.copiedVariable} saving={state.savingKey === selected.key} dirty={state.isDirty(selected)} onBodyDraft={(value) => state.setBodyDrafts((previous) => ({ ...previous, [selected.key]: value }))} onSubjectDraft={(value) => state.setSubjectDrafts((previous) => ({ ...previous, [selected.key]: value }))} onCssDraft={(value) => state.setCssDrafts((previous) => ({ ...previous, [selected.key]: value }))} onAuthorMode={state.setAuthorMode} onPreviewSurface={state.setPreviewSurface} onPreviewMode={state.setPreviewMode} onCompareMode={() => state.setCompareMode((previous) => !previous)} onCopyVariable={(name) => void state.copyVariable(name)} onReset={() => void state.resetToDefault(selected)} onSave={() => void state.saveTemplate(selected)} onPublish={() => void state.runTemplateAction(selected, 'publish')} onOpenTest={() => state.setTestDialogOpen(true)} onRestore={(version) => void state.restoreRevision(selected, version)} /> : <div className="flex items-center justify-center rounded-lg border border-dashed border-border p-10 text-sm text-muted-foreground">Select a message template to edit it.</div>}
    </div>
  </div>;
}
