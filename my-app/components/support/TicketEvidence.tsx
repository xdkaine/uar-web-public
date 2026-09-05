'use client';

import Image from 'next/image';
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Loader2, UploadCloud, FileText, Download, ImageIcon, ChevronLeft, ChevronRight, Maximize2, Eye, Copy, Check } from 'lucide-react';
import { ReadOnlyCodeViewer } from './ReadOnlyCodeViewer';
import { contentUrl, EVIDENCE_ACCEPT, formatBytes, MAX_EVIDENCE_BYTES, MAX_FILES_PER_TICKET, type TicketAttachment } from './TicketEvidence.shared';
import { LocalizedDateTime } from './LocalizedDateTime';


interface TicketEvidenceProps {
  ticketId: string;
  /** Upload rights mirror ticket mutation access (creator/admin/assignee). */
  canMutate: boolean;
}

/**
 * Evidence gallery + uploader for one support ticket. Every byte is served
 * through the protected per-ticket content endpoint, which re-verifies the
 * viewer's access on each request - nothing here is publicly reachable.
 */
export default function TicketEvidence({ ticketId, canMutate }: TicketEvidenceProps) {
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  /** Index into imageAttachments for the fullscreen viewer; null = closed. */
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [fileViewer, setFileViewer] = useState<TicketAttachment | null>(null);
  const [filePreview, setFilePreview] = useState<{ text: string; language: string; truncated: boolean } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [wrapped, setWrapped] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const imageAttachments = useMemo(
    () => attachments.filter((a) => a.contentType.startsWith('image/')),
    [attachments]
  );

  const stepViewer = useCallback(
    (delta: number) => {
      setViewerIndex((current) => {
        if (current === null || imageAttachments.length === 0) return current;
        return (current + delta + imageAttachments.length) % imageAttachments.length;
      });
    },
    [imageAttachments.length]
  );

  const stepViewerFromKeyboard = useEffectEvent((delta: number) => {
    setViewerIndex((current) => {
      if (current === null || imageAttachments.length === 0) return current;
      return (current + delta + imageAttachments.length) % imageAttachments.length;
    });
  });

  useEffect(() => {
    if (viewerIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') stepViewerFromKeyboard(-1);
      if (e.key === 'ArrowRight') stepViewerFromKeyboard(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewerIndex]);

  const openFile = async (attachment: TicketAttachment) => {
    setFileViewer(attachment);
    setFilePreview(null);
    setCopied(false);
    if (attachment.contentType === 'application/pdf') return;
    setPreviewLoading(true);
    try {
      const response = await fetch(`/api/support/tickets/${ticketId}/attachments/${attachment.id}/preview`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Preview failed');
      setFilePreview({ text: body.text ?? '', language: body.language ?? 'text', truncated: body.truncated === true });
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Preview failed');
      setFileViewer(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/support/tickets/${ticketId}/attachments`);
      if (!res.ok) throw new Error('Failed to load evidence');
      const data = await res.json();
      setAttachments(data.attachments ?? []);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load evidence');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  const uploadFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading(true);
    setError('');
    try {
      for (const file of files) {
        if (file.size <= 0 || file.size > MAX_EVIDENCE_BYTES) {
          throw new Error(`${file.name}: files must be under ${formatBytes(MAX_EVIDENCE_BYTES)}`);
        }
      }
      if (attachments.length + files.length > MAX_FILES_PER_TICKET) {
        throw new Error(`Tickets allow at most ${MAX_FILES_PER_TICKET} attachments`);
      }
      const form = new FormData();
      for (const file of files) form.append('files', file);
      const res = await fetchWithCsrf(`/api/support/tickets/${ticketId}/attachments`, {
        method: 'POST',
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading evidence…
        </div>
      ) : (
        <>
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {attachments.length === 0 && !canMutate && (
            <p className="text-sm text-muted-foreground">No evidence attached.</p>
          )}

          {attachments.length > 0 && (
            <ul className="grid gap-2">
              {attachments.map((attachment) => {
                const imageIdx = imageAttachments.findIndex((img) => img.id === attachment.id);
                return (
                  <li
                    key={attachment.id}
                    className="flex min-w-0 items-center gap-3 rounded-lg border p-2 hover:bg-muted/30 transition-colors"
                  >
                    {attachment.contentType.startsWith('image/') ? (
                      // Served through the authorized endpoint; never a static path.
                      <button
                        type="button"
                        onClick={() => setViewerIndex(imageIdx)}
                        className="group relative h-12 w-12 shrink-0 overflow-hidden rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={`View ${attachment.filename}`}
                      >
                        <Image
                          src={contentUrl(ticketId, attachment.id)}
                          alt={attachment.filename}
                          width={48}
                          height={48}
                          unoptimized
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          loading="lazy"
                        />
                        <span className="absolute inset-0 hidden items-center justify-center bg-black/40 group-hover:flex">
                          <Maximize2 className="h-4 w-4 text-white" />
                        </span>
                      </button>
                    ) : (
                      <span className="flex h-12 w-12 items-center justify-center rounded border bg-muted/40">
                        <FileText className="h-6 w-6 text-muted-foreground" />
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 break-all text-sm font-medium leading-5" title={attachment.filename}>
                        {attachment.filename}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(attachment.sizeBytes)}
                        {attachment.createdAt && <> · <LocalizedDateTime value={attachment.createdAt} style="date" /></>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {(imageIdx >= 0 || attachment.contentType === 'text/plain' || (attachment.contentType === 'application/pdf' && attachment.scanStatus === 'clean')) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => imageIdx >= 0 ? setViewerIndex(imageIdx) : void openFile(attachment)}
                          aria-label={`Preview ${attachment.filename}`}
                          title="Preview"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button asChild variant="ghost" size="icon" className="h-8 w-8">
                        <a
                          href={contentUrl(ticketId, attachment.id)}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Download ${attachment.filename}`}
                          title="Download"
                        >
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {canMutate && (
            <div
              className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
                dragOver ? 'border-primary bg-primary/5' : 'border-border'
              }`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void uploadFiles(Array.from(e.dataTransfer.files));
              }}
            >
              <input
                ref={inputRef}
                type="file"
                multiple
                accept={EVIDENCE_ACCEPT}
                className="hidden"
                id={`evidence-input-${ticketId}`}
                onChange={(e) => void uploadFiles(Array.from(e.target.files ?? []))}
              />
              {uploading ? (
                <span className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Uploading…
                </span>
              ) : (
                <div className="space-y-1.5">
                  <UploadCloud className="mx-auto h-6 w-6 text-muted-foreground" />
                  <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
                    <span className="text-muted-foreground">Drag files here or</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => inputRef.current?.click()}
                    >
                      Browse
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground flex flex-wrap items-center justify-center gap-1">
                    <ImageIcon className="h-3 w-3" /> Images, documents, archives, and source files · max {formatBytes(MAX_EVIDENCE_BYTES)} each ·{' '}
                    <Badge variant="secondary">{MAX_FILES_PER_TICKET - attachments.length} slots left</Badge>
                  </p>
                  <p className="text-[11px] text-muted-foreground/80">
                    Evidence is private: only you and people with access to this ticket can view it.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <ImageEvidenceDialog ticketId={ticketId} attachments={imageAttachments} viewerIndex={viewerIndex} setViewerIndex={setViewerIndex} stepViewer={stepViewer} />
      <FileEvidenceDialog ticketId={ticketId} fileViewer={fileViewer} filePreview={filePreview} previewLoading={previewLoading} wrapped={wrapped} copied={copied} setFileViewer={setFileViewer} setFilePreview={setFilePreview} setWrapped={setWrapped} setCopied={setCopied} />
    </div>
  );
}

function ImageEvidenceDialog({ ticketId, attachments, viewerIndex, setViewerIndex, stepViewer }: { ticketId: string; attachments: TicketAttachment[]; viewerIndex: number | null; setViewerIndex: (index: number | null) => void; stepViewer: (delta: number) => void }) {
  const current = viewerIndex === null ? null : attachments[viewerIndex] ?? null;
  return <Dialog open={current !== null} onOpenChange={(open) => { if (!open) setViewerIndex(null); }}><DialogContent size="wide" className="flex min-h-0 flex-col gap-2 overflow-hidden border-border bg-black/90 p-2 [&>button]:text-white/70 [&>button]:hover:text-white">{current && <><DialogTitle className="flex shrink-0 items-start justify-between gap-3 px-2 pr-10 pt-1 text-sm font-medium text-white/90"><span className="line-clamp-2 min-w-0 flex-1 break-all leading-5">{current.filename}</span><span className="shrink-0 pt-0.5 text-xs text-white/60">{viewerIndex! + 1} of {attachments.length}</span></DialogTitle><div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"><Image src={contentUrl(ticketId, current.id)} alt={current.filename} fill unoptimized sizes="100vw" className="rounded object-contain" />{attachments.length > 1 && <><button type="button" onClick={() => stepViewer(-1)} className="absolute left-2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70" aria-label="Previous image"><ChevronLeft className="h-5 w-5" /></button><button type="button" onClick={() => stepViewer(1)} className="absolute right-2 rounded-full bg-black/50 p-2 text-white hover:bg-black/70" aria-label="Next image"><ChevronRight className="h-5 w-5" /></button></>}</div><div className="flex shrink-0 items-center justify-between px-2 pb-1"><p className="text-xs text-white/60">Use ← / → keys to move between images</p><a href={contentUrl(ticketId, current.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-white/80 hover:bg-white/10 hover:text-white"><Download className="h-3.5 w-3.5" /> Download</a></div></>}</DialogContent></Dialog>;
}

function FileEvidenceDialog({ ticketId, fileViewer, filePreview, previewLoading, wrapped, copied, setFileViewer, setFilePreview, setWrapped, setCopied }: { ticketId: string; fileViewer: TicketAttachment | null; filePreview: { text: string; language: string; truncated: boolean } | null; previewLoading: boolean; wrapped: boolean; copied: boolean; setFileViewer: (value: TicketAttachment | null) => void; setFilePreview: (value: { text: string; language: string; truncated: boolean } | null) => void; setWrapped: React.Dispatch<React.SetStateAction<boolean>>; setCopied: (value: boolean) => void }) {
  return <Dialog open={fileViewer !== null} onOpenChange={(open) => { if (!open) { setFileViewer(null); setFilePreview(null); } }}><DialogContent size="wide" className="flex min-h-0 flex-col gap-0 overflow-hidden p-0"><div className="flex items-center justify-between gap-3 border-b px-5 py-3 pr-12"><div className="min-w-0"><DialogTitle className="truncate text-base">{fileViewer?.filename}</DialogTitle><p className="mt-1 text-xs text-muted-foreground">Read-only ticket evidence{filePreview?.truncated ? ' · showing the first 1 MiB' : ''}</p></div><div className="flex shrink-0 items-center gap-1">{filePreview && <><Button size="sm" variant="ghost" onClick={() => setWrapped((value) => !value)}>{wrapped ? 'No wrap' : 'Wrap lines'}</Button><Button size="sm" variant="ghost" onClick={async () => { await navigator.clipboard.writeText(filePreview.text); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}</Button></>}{fileViewer && <Button asChild size="sm" variant="outline"><a href={contentUrl(ticketId, fileViewer.id)}><Download className="h-4 w-4" /> Download</a></Button>}</div></div><div className="min-h-0 flex-1 bg-muted/20 p-3">{previewLoading && <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading protected preview…</div>}{fileViewer?.contentType === 'application/pdf' && <iframe title={fileViewer.filename} sandbox="allow-same-origin" referrerPolicy="no-referrer" src={`${contentUrl(ticketId, fileViewer.id)}?preview=1`} className="h-full min-h-[60vh] w-full border bg-white" />}{filePreview && <ReadOnlyCodeViewer value={filePreview.text} language={filePreview.language} wrap={wrapped} />}</div></DialogContent></Dialog>;
}
