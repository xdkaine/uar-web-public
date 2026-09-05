'use client';

import { Check, Copy, Loader2, MailCheck, RotateCcw, Save } from 'lucide-react';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { messageEditorInstanceKey } from '@/lib/messages/editor-state';
import { CodeEditor } from './CodeEditor';
import { MessageBodyEditor } from './MessageBodyEditor';
import { MessageTemplatePreview } from './MessageTemplatePreview';
import type { AuthorMode, MessageRevision, MessageTemplate, PreviewContent, PreviewMode, PreviewSurface } from './message-panel-types';

const AUTHOR_MODES: Array<{ id: AuthorMode; label: string; title: string }> = [
  { id: 'blocks', label: 'Blocks', title: 'Edit the message as ordered email sections' },
  { id: 'document', label: 'Document', title: 'Use rich text when the source can be represented losslessly' },
  { id: 'canvas', label: 'Canvas', title: 'Arrange message sections on a visual canvas' },
  { id: 'html', label: 'HTML', title: 'Edit the exact message source' },
  { id: 'css', label: 'CSS', title: 'Edit delivery styles' },
];

export function MessageTemplateEditor({ template, revisions, bodyDraft, subjectDraft, cssDraft, authorMode, previewSurface, previewMode, compareMode, previews, previewLoading, copiedVariable, saving, dirty, onBodyDraft, onSubjectDraft, onCssDraft, onAuthorMode, onPreviewSurface, onPreviewMode, onCompareMode, onCopyVariable, onReset, onSave, onPublish, onOpenTest, onRestore }: {
  template: MessageTemplate;
  revisions: MessageRevision[];
  bodyDraft: string;
  subjectDraft: string;
  cssDraft: string;
  authorMode: AuthorMode;
  previewSurface: PreviewSurface;
  previewMode: PreviewMode;
  compareMode: boolean;
  previews: Record<string, PreviewContent>;
  previewLoading: boolean;
  copiedVariable: string | null;
  saving: boolean;
  dirty: boolean;
  onBodyDraft: (value: string) => void;
  onSubjectDraft: (value: string) => void;
  onCssDraft: (value: string) => void;
  onAuthorMode: (mode: AuthorMode) => void;
  onPreviewSurface: (surface: PreviewSurface) => void;
  onPreviewMode: (mode: PreviewMode) => void;
  onCompareMode: () => void;
  onCopyVariable: (name: string) => void;
  onReset: () => void;
  onSave: () => void;
  onPublish: () => void;
  onOpenTest: () => void;
  onRestore: (version: number | 'original') => void;
}) {
  return <Card className={cn(dirty && 'ring-1 ring-amber-500/40')}><CardContent className="space-y-4 p-5">
    <EditorHeader template={template} saving={saving} dirty={dirty} onReset={onReset} onSave={onSave} onPublish={onPublish} onOpenTest={onOpenTest} />
    {(template.subjectOnly || template.subject !== null) && <SubjectField template={template} value={subjectDraft} onChange={onSubjectDraft} />}
    {!template.subjectOnly && <MessageContent template={template} authorMode={authorMode} bodyDraft={bodyDraft} cssDraft={cssDraft} onAuthorMode={onAuthorMode} onBodyDraft={onBodyDraft} onCssDraft={onCssDraft} />}
    {template.variables.length > 0 && <VariableList variables={template.variables} copiedVariable={copiedVariable} onCopy={onCopyVariable} />}
    <MessageTemplatePreview selectedKey={template.key} previews={previews} previewMode={previewMode} compareMode={compareMode} previewSurface={previewSurface} previewLoading={previewLoading} onPreviewMode={onPreviewMode} onCompareMode={onCompareMode} onPreviewSurface={onPreviewSurface} updatedBy={template.updatedBy} updatedAt={template.updatedAt} publishedVersion={template.publishedVersion} />
    <RevisionHistory template={template} revisions={revisions} saving={saving} onRestore={onRestore} />
  </CardContent></Card>;
}

function EditorHeader({ template, saving, dirty, onReset, onSave, onPublish, onOpenTest }: { template: MessageTemplate; saving: boolean; dirty: boolean; onReset: () => void; onSave: () => void; onPublish: () => void; onOpenTest: () => void }) {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="truncate text-base font-semibold">{template.label}</h3>{template.customized && <Badge variant="secondary">customized</Badge>}{dirty && <Badge variant="outline">unsaved</Badge>}</div><code className="font-mono text-xs text-muted-foreground">{template.key}</code></div><div className="flex items-center gap-2"><Button type="button" variant="outline" size="sm" onClick={onReset} disabled={saving}><RotateCcw className="mr-1.5 h-4 w-4" />Reset to default</Button><Button type="button" variant="outline" size="sm" disabled={saving || dirty} onClick={onOpenTest}><MailCheck className="mr-1.5 h-4 w-4" />Send test</Button><Button size="sm" disabled={!dirty || saving} onClick={onSave}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save draft</Button><Button size="sm" variant="default" disabled={saving || dirty || template.draftVersion === null} onClick={onPublish}>Publish</Button></div></div>;
}

function SubjectField({ template, value, onChange }: { template: MessageTemplate; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-1.5"><Label htmlFor={`subject-${template.key}`} className="flex items-center gap-1.5">Subject line{template.subjectOnly && <Badge variant="outline">subject only</Badge>}</Label><Input id={`subject-${template.key}`} maxLength={300} value={value} placeholder={template.subject ?? ''} onChange={(event) => onChange(event.target.value)} />{!template.subjectOnly && <p className="text-xs text-muted-foreground">Clear this field and save to restore the built-in subject.</p>}</div>;
}

function MessageContent({ template, authorMode, bodyDraft, cssDraft, onAuthorMode, onBodyDraft, onCssDraft }: { template: MessageTemplate; authorMode: AuthorMode; bodyDraft: string; cssDraft: string; onAuthorMode: (mode: AuthorMode) => void; onBodyDraft: (value: string) => void; onCssDraft: (value: string) => void }) {
  const bodyEditor = authorMode === 'blocks' || authorMode === 'document' || authorMode === 'canvas';
  return <div className="space-y-1.5"><div className="flex items-center justify-between gap-3"><Label>Content</Label><div className="inline-flex max-w-full overflow-x-auto rounded-md border border-border p-0.5" role="tablist" aria-label="Authoring mode">{AUTHOR_MODES.map((mode) => <button key={mode.id} type="button" role="tab" aria-selected={authorMode === mode.id} title={mode.title} onClick={() => onAuthorMode(mode.id)} className={cn('whitespace-nowrap rounded px-2.5 py-1 text-xs', authorMode === mode.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted')}>{mode.label}</button>)}</div></div>{bodyEditor ? <MessageBodyEditor key={messageEditorInstanceKey({ key: template.key, mode: authorMode as 'blocks' | 'document' | 'canvas', draftVersion: template.draftVersion, draftUpdatedAt: template.draftUpdatedAt, publishedUpdatedAt: template.updatedAt })} mode={authorMode} value={bodyDraft} variables={template.variables} onChange={onBodyDraft} /> : authorMode === 'html' ? <CodeEditor value={bodyDraft} onChange={onBodyDraft} language="html" ariaLabel="Message HTML" /> : <CodeEditor value={cssDraft} onChange={onCssDraft} language="css" ariaLabel="Message CSS" />}<p className="text-xs text-muted-foreground">Email HTML and CSS are sanitized and inlined by the same pipeline used for preview, test, and delivery. JavaScript is never accepted.</p></div>;
}

function VariableList({ variables, copiedVariable, onCopy }: { variables: MessageTemplate['variables']; copiedVariable: string | null; onCopy: (name: string) => void }) {
  return <div className="space-y-1.5"><Label>Placeholders</Label><div className="flex flex-wrap gap-1.5">{variables.map((variable) => <button key={variable.name} type="button" title={variable.description} onClick={() => onCopy(variable.name)} className={cn('inline-flex items-center gap-1 rounded-full border border-border bg-muted/50 px-2 py-0.5 font-mono text-xs transition-colors hover:bg-muted', copiedVariable === variable.name && 'border-emerald-500 text-emerald-700 dark:text-emerald-400')}>{copiedVariable === variable.name ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}{`{{${variable.name}}}`}</button>)}</div><p className="text-xs text-muted-foreground">Click to copy. Delivery fills these values from the request, ticket, account, or lifecycle record.</p></div>;
}

function RevisionHistory({ template, revisions, saving, onRestore }: { template: MessageTemplate; revisions: MessageRevision[]; saving: boolean; onRestore: (version: number | 'original') => void }) {
  const templateRevisions: MessageRevision[] = [];
  for (const revision of revisions) {
    if (revision.templateKey === template.key) templateRevisions.push(revision);
  }
  return <details className="border-t pt-4"><summary className="cursor-pointer text-sm font-medium">Revision history</summary><div className="mt-2 max-h-80 divide-y overflow-y-auto rounded-md border"><div className="flex items-center justify-between gap-2 px-3 py-2 text-xs"><span><strong>Built-in original</strong> · hardcoded application copy</span><Button variant="ghost" size="sm" disabled={saving} onClick={() => onRestore('original')}>Restore as draft</Button></div>{templateRevisions.map((revision) => <div key={revision.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs"><span>v{revision.version} · {revision.status} · saved <ClientLocalDate value={revision.createdAt || revision.updatedAt} /> by {revision.updatedBy}</span><Button variant="ghost" size="sm" disabled={saving || revision.status === 'draft'} onClick={() => onRestore(revision.version)}>Restore as draft</Button></div>)}</div></details>;
}
