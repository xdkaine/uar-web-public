'use client';

import { useRef, useState } from 'react';
import { FileText, UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EVIDENCE_ACCEPT, formatBytes, stagedEvidenceFileId, validateStagedEvidenceFiles } from './TicketEvidence.shared';

export function StagedEvidencePicker({ files, onAdd, onRemove, onError }: {
  files: File[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const addFiles = (incoming: File[]) => {
    const result = validateStagedEvidenceFiles(incoming, files.length);
    if (result.error) return onError(result.error);
    onError('');
    onAdd(result.accepted);
  };
  return <div className="space-y-2">
    <div className={`rounded-lg border-2 border-dashed p-4 text-center transition-colors ${dragOver ? 'border-primary bg-primary/5' : 'border-border'}`}
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
      onDrop={(event) => { event.preventDefault(); setDragOver(false); addFiles(Array.from(event.dataTransfer.files)); }}>
      <input ref={inputRef} type="file" multiple accept={EVIDENCE_ACCEPT} className="hidden" id="staged-evidence-input" onChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <UploadCloud className="mx-auto h-6 w-6 text-muted-foreground" />
      <div className="mt-1.5 flex flex-wrap items-center justify-center gap-2 text-sm"><span className="text-muted-foreground">Drag screenshots or PDFs here, or</span><Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>Browse</Button></div>
      <p className="mt-1 text-xs text-muted-foreground">Uploaded after the ticket is created. Only authorized viewers will see it.</p>
    </div>
    {files.length > 0 && <ul className="space-y-1.5">{files.map((file, index) => <li key={stagedEvidenceFileId(file)} className="flex items-center gap-2 rounded border bg-muted/20 px-2 py-1.5"><FileText className="h-4 w-4 shrink-0 text-muted-foreground" /><span className="truncate text-sm flex-1">{file.name}</span><span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span><button type="button" aria-label={`Remove ${file.name}`} className="rounded p-1 hover:bg-muted" onClick={() => onRemove(index)}><X className="h-3.5 w-3.5" /></button></li>)}</ul>}
  </div>;
}
