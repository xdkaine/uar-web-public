'use client';

import { Loader2, Columns2 } from 'lucide-react';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PreviewContent, PreviewMode, PreviewSurface } from './message-panel-types';

const MODE_LABELS: Record<PreviewMode, string> = { draft: 'Draft', saved: 'Saved', default: 'Default' };

export function MessageTemplatePreview({ selectedKey, previews, previewMode, compareMode, previewSurface, previewLoading, onPreviewMode, onCompareMode, onPreviewSurface, updatedBy, updatedAt, publishedVersion }: {
  selectedKey: string;
  previews: Record<string, PreviewContent>;
  previewMode: PreviewMode;
  compareMode: boolean;
  previewSurface: PreviewSurface;
  previewLoading: boolean;
  onPreviewMode: (mode: PreviewMode) => void;
  onCompareMode: () => void;
  onPreviewSurface: (surface: PreviewSurface) => void;
  updatedBy: string | null;
  updatedAt: string | null;
  publishedVersion: number | null;
}) {
  const draftPreview = previews[`${selectedKey}:draft`];
  const savedPreview = previews[`${selectedKey}:saved`];
  const defaultPreview = previews[`${selectedKey}:default`];
  const activePreview = previewMode === 'draft' ? draftPreview : previewMode === 'saved' ? savedPreview : defaultPreview;
  return <div className="space-y-2 border-t border-border pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      {compareMode ? <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">Saved vs live working copy{previewLoading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}</div> : <PreviewSourceTabs mode={previewMode} loading={previewLoading} onChange={onPreviewMode} />}
      <Button type="button" variant={compareMode ? 'default' : 'outline'} size="sm" aria-pressed={compareMode} onClick={onCompareMode}><Columns2 className="mr-1.5 h-4 w-4" />Before / After</Button>
      <div className="inline-flex rounded-md border border-border p-0.5" aria-label="Preview format">
        {(['desktop', 'mobile', 'text', 'source'] as PreviewSurface[]).map((surface) => <button key={surface} type="button" onClick={() => onPreviewSurface(surface)} className={cn('rounded px-2 py-1 text-xs capitalize', previewSurface === surface ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground')}>{surface}</button>)}
      </div>
    </div>
    {compareMode ? <div className="flex flex-col gap-3 md:flex-row"><PreviewPane content={savedPreview} label="Before — Saved" surface={previewSurface} loading={previewLoading} /><PreviewPane content={draftPreview} label="After — Working copy (live)" surface={previewSurface} loading={previewLoading} /></div> : <PreviewPane content={activePreview} label={`${MODE_LABELS[previewMode]} preview`} surface={previewSurface} loading={previewLoading} />}
    <p className="text-xs text-muted-foreground">{updatedBy ? <>Published v{publishedVersion ?? '—'} by {updatedBy}{updatedAt && <> at <ClientLocalDate value={updatedAt} /></>}</> : 'Using the built-in default content'} · Previews use sample values and are never sent.</p>
  </div>;
}

function PreviewSourceTabs({ mode, loading, onChange }: { mode: PreviewMode; loading: boolean; onChange: (mode: PreviewMode) => void }) {
  return <div className="flex items-center gap-1" role="tablist" aria-label="Preview source">
    {(['draft', 'saved', 'default'] as PreviewMode[]).map((item) => <button key={item} type="button" role="tab" aria-selected={mode === item} onClick={() => onChange(item)} className={cn('rounded-full px-3 py-1 text-xs font-medium transition-colors', mode === item ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground')}>{MODE_LABELS[item]}</button>)}
    {loading && <Loader2 className="ml-1 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
  </div>;
}

function PreviewPane({ content, label, surface, loading }: { content: PreviewContent | undefined; label: string; surface: PreviewSurface; loading: boolean }) {
  return <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border border-border">
    <div className="flex items-center justify-between border-b border-border bg-muted/50 px-3 py-1.5"><span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>{loading && !content && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}</div>
    <div className="border-b border-border bg-muted/30 px-3 py-1.5"><p className="truncate text-xs"><span className="font-medium text-muted-foreground">Subject: </span>{content?.subject || <span className="italic text-muted-foreground">(none)</span>}</p></div>
    {surface === 'text' ? <pre className="max-h-[420px] min-h-[220px] overflow-auto whitespace-pre-wrap bg-background p-4 font-mono text-xs">{content?.text ?? ''}</pre> : surface === 'source' ? <pre className="max-h-[420px] min-h-[220px] overflow-auto whitespace-pre-wrap bg-slate-950 p-4 font-mono text-xs text-slate-100">{content?.html ?? ''}</pre> : <div className="flex justify-center bg-slate-100 p-3 dark:bg-slate-950"><iframe title={`${label} email preview`} sandbox="" referrerPolicy="no-referrer" srcDoc={content?.html ?? ''} className={cn('min-h-[360px] border-0 bg-white shadow-sm', surface === 'mobile' ? 'w-[390px]' : 'w-full max-w-[760px]')} /></div>}
    {!!content?.diagnostics?.length && <div className="border-t border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">{content.diagnostics.join(' · ')}</div>}
  </div>;
}
