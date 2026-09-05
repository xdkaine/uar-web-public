'use client';

import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Blocks,
  Copy,
  FileText,
  GripVertical,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  EMAIL_BLOCK_PRESETS,
  parseEmailBlockDocument,
  serializeEmailBlockDocument,
  type EmailContentBlock,
} from '@/lib/messages/email-blocks';
import { TemplateEditor, type TemplateVariableOption } from './TemplateEditor';

export type MessageBodyEditorMode = 'blocks' | 'document' | 'canvas';

interface MessageBodyEditorProps {
  mode: MessageBodyEditorMode;
  value: string;
  onChange: (value: string) => void;
  variables: TemplateVariableOption[];
}

function useBlockValue(value: string, onChange: (value: string) => void) {
  const document = useMemo(() => parseEmailBlockDocument(value), [value]);
  const commit = (blocks: EmailContentBlock[]) => {
    onChange(serializeEmailBlockDocument({ ...document, blocks }));
  };
  return { document, commit };
}

function blockSummary(block: EmailContentBlock) {
  const text = block.html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text || block.html.trim().slice(0, 100) || 'Empty section';
}

function keyedBlocks(blocks: EmailContentBlock[]) {
  const occurrences = new Map<string, number>();
  return blocks.map((block) => {
    const identity = `${block.kind}:${block.html}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return { block, key: `${identity}:${occurrence}` };
  });
}

function AddBlockControl({ onAdd }: { onAdd: (presetIndex: number) => void }) {
  const [presetIndex, setPresetIndex] = useState(0);
  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label="Block type"
        value={presetIndex}
        onChange={(event) => setPresetIndex(Number(event.target.value))}
        className="h-8 rounded-md border border-input bg-background px-2 text-xs"
      >
        {EMAIL_BLOCK_PRESETS.map((preset, index) => (
          <option key={preset.kind} value={index}>{preset.label}</option>
        ))}
      </select>
      <Button type="button" size="sm" variant="outline" onClick={() => onAdd(presetIndex)}>
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </div>
  );
}

function VariableControl({
  variables,
  onInsert,
}: {
  variables: TemplateVariableOption[];
  onInsert: (token: string) => void;
}) {
  const [variable, setVariable] = useState(variables[0]?.name ?? '');
  if (variables.length === 0) return null;
  const selected = variables.some((entry) => entry.name === variable)
    ? variable
    : variables[0].name;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="message-block-variable">Insert placeholder</Label>
      <div className="flex gap-1.5">
        <select
          id="message-block-variable"
          value={selected}
          onChange={(event) => setVariable(event.target.value)}
          className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs"
        >
          {variables.map((entry) => (
            <option key={entry.name} value={entry.name}>{`{{${entry.name}}}`}</option>
          ))}
        </select>
        <Button type="button" size="sm" variant="outline" onClick={() => onInsert(`{{${selected}}}`)}>
          Insert
        </Button>
      </div>
    </div>
  );
}

function BlockInspector({
  block,
  index,
  count,
  variables,
  onHtmlChange,
  onMove,
  onDuplicate,
  onDelete,
}: {
  block: EmailContentBlock;
  index: number;
  count: number;
  variables: TemplateVariableOption[];
  onHtmlChange: (html: string) => void;
  onMove: (offset: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <aside className="space-y-3 rounded-lg border bg-muted/15 p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">{block.label}</p>
          <p className="text-xs text-muted-foreground">Section {index + 1} of {count}</p>
        </div>
        {block.kind === 'custom-html' && <Badge variant="secondary">HTML</Badge>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="message-block-html">Section HTML</Label>
        <textarea
          id="message-block-html"
          value={block.html}
          onChange={(event) => onHtmlChange(event.target.value)}
          className="min-h-64 w-full rounded-md border border-input bg-background p-2 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
      <VariableControl variables={variables} onInsert={(token) => onHtmlChange(`${block.html}${token}`)} />
      <div className="grid grid-cols-4 gap-1">
        <Button type="button" size="icon-sm" variant="outline" aria-label="Move section up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp /></Button>
        <Button type="button" size="icon-sm" variant="outline" aria-label="Move section down" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown /></Button>
        <Button type="button" size="icon-sm" variant="outline" aria-label="Duplicate section" onClick={onDuplicate}><Copy /></Button>
        <Button type="button" size="icon-sm" variant="outline" aria-label="Delete section" onClick={onDelete}><Trash2 /></Button>
      </div>
    </aside>
  );
}

function BlocksEditor({ value, onChange, variables }: Omit<MessageBodyEditorProps, 'mode'>) {
  const { document, commit } = useBlockValue(value, onChange);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const safeIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, document.blocks.length - 1));
  const selected = document.blocks[safeIndex] ?? null;

  const update = (index: number, html: string) => {
    commit(document.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, html } : block));
  };
  const move = (index: number, offset: number) => {
    const target = Math.max(0, Math.min(document.blocks.length - 1, index + offset));
    if (target === index) return;
    const next = [...document.blocks];
    const [block] = next.splice(index, 1);
    next.splice(target, 0, block);
    setSelectedIndex(target);
    commit(next);
  };
  const add = (presetIndex: number) => {
    const preset = EMAIL_BLOCK_PRESETS[presetIndex];
    if (!preset) return;
    const next = [...document.blocks, { ...preset, id: `${preset.kind}-${document.blocks.length + 1}` }];
    setSelectedIndex(next.length - 1);
    commit(next);
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/25 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium"><Blocks className="h-4 w-4" /> {document.blocks.length} sections</div>
        <AddBlockControl onAdd={add} />
      </div>
      <div className="grid gap-3 p-3 lg:grid-cols-[minmax(220px,.75fr)_minmax(320px,1.25fr)]">
        <div className="max-h-[520px] space-y-1 overflow-auto pr-1" aria-label="Email sections">
          {keyedBlocks(document.blocks).map(({ block, key }, index) => (
            <button
              key={key}
              type="button"
              aria-current={safeIndex === index}
              onClick={() => setSelectedIndex(index)}
              className={cn(
                'flex w-full items-start gap-2 rounded-md border px-2.5 py-2 text-left',
                safeIndex === index ? 'border-primary bg-primary/5' : 'border-transparent hover:border-border hover:bg-muted/40',
              )}
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded bg-muted font-mono text-[10px]">{index + 1}</span>
              <span className="min-w-0 flex-1"><span className="block text-xs font-semibold">{block.label}</span><span className="mt-0.5 block truncate text-xs text-muted-foreground">{blockSummary(block)}</span></span>
            </button>
          ))}
        </div>
        {selected ? (
          <BlockInspector
            block={selected}
            index={safeIndex}
            count={document.blocks.length}
            variables={variables}
            onHtmlChange={(html) => update(safeIndex, html)}
            onMove={(offset) => move(safeIndex, offset)}
            onDuplicate={() => {
              const next = [...document.blocks];
              next.splice(safeIndex + 1, 0, { ...selected, id: `${selected.kind}-${document.blocks.length + 1}` });
              setSelectedIndex(safeIndex + 1);
              commit(next);
            }}
            onDelete={() => {
              commit(document.blocks.filter((_, index) => index !== safeIndex));
              setSelectedIndex(Math.max(0, safeIndex - 1));
            }}
          />
        ) : (
          <div className="grid min-h-52 place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">Add a section to begin.</div>
        )}
      </div>
    </div>
  );
}

function CanvasEditor({ value, onChange, variables }: Omit<MessageBodyEditorProps, 'mode'>) {
  const { document, commit } = useBlockValue(value, onChange);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dragIndex = useRef<number | null>(null);
  const safeIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, document.blocks.length - 1));
  const selected = document.blocks[safeIndex] ?? null;

  const move = (index: number, offset: number) => {
    const target = Math.max(0, Math.min(document.blocks.length - 1, index + offset));
    if (target === index) return;
    const next = [...document.blocks];
    const [block] = next.splice(index, 1);
    next.splice(target, 0, block);
    setSelectedIndex(target);
    commit(next);
  };
  const dropAt = (target: number) => {
    if (dragIndex.current === null || dragIndex.current === target) return;
    const next = [...document.blocks];
    const [block] = next.splice(dragIndex.current, 1);
    next.splice(target, 0, block);
    setSelectedIndex(target);
    dragIndex.current = null;
    commit(next);
  };
  const add = (presetIndex: number) => {
    const preset = EMAIL_BLOCK_PRESETS[presetIndex];
    if (!preset) return;
    const next = [...document.blocks, { ...preset, id: `${preset.kind}-${document.blocks.length + 1}` }];
    setSelectedIndex(next.length - 1);
    commit(next);
  };

  return (
    <div className="overflow-hidden rounded-lg border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/25 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-medium"><FileText className="h-4 w-4" /> Message canvas</div>
        <AddBlockControl onAdd={add} />
      </div>
      <div className="grid gap-3 p-3 xl:grid-cols-[minmax(360px,1.35fr)_minmax(300px,.65fr)]">
        <div className="min-h-[440px] rounded-lg border bg-muted/20 p-3">
          <div className="mx-auto max-w-[640px] space-y-2">
            {keyedBlocks(document.blocks).map(({ block, key }, index) => (
              <div
                key={key}
                draggable
                onDragStart={() => { dragIndex.current = index; }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropAt(index)}
                className={cn('rounded-md border bg-background p-2 shadow-sm', safeIndex === index && 'border-primary ring-1 ring-primary/25')}
              >
                <div className="flex items-center gap-1.5">
                  <GripVertical className="h-4 w-4 shrink-0 cursor-grab text-muted-foreground" />
                  <button type="button" onClick={() => setSelectedIndex(index)} aria-pressed={safeIndex === index} className="min-w-0 flex-1 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="block text-xs font-semibold">{block.label}</span>
                    <span className="block truncate text-xs text-muted-foreground">{blockSummary(block)}</span>
                  </button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Move ${block.label} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp /></Button>
                  <Button type="button" size="icon-sm" variant="ghost" aria-label={`Move ${block.label} down`} disabled={index === document.blocks.length - 1} onClick={() => move(index, 1)}><ArrowDown /></Button>
                </div>
              </div>
            ))}
            {document.blocks.length === 0 && <div className="grid min-h-52 place-items-center rounded-md border border-dashed text-sm text-muted-foreground">Add a section to begin.</div>}
          </div>
        </div>
        {selected && (
          <BlockInspector
            block={selected}
            index={safeIndex}
            count={document.blocks.length}
            variables={variables}
            onHtmlChange={(html) => commit(document.blocks.map((block, index) => index === safeIndex ? { ...block, html } : block))}
            onMove={(offset) => move(safeIndex, offset)}
            onDuplicate={() => {
              const next = [...document.blocks];
              next.splice(safeIndex + 1, 0, { ...selected, id: `${selected.kind}-${document.blocks.length + 1}` });
              setSelectedIndex(safeIndex + 1);
              commit(next);
            }}
            onDelete={() => {
              commit(document.blocks.filter((_, index) => index !== safeIndex));
              setSelectedIndex(Math.max(0, safeIndex - 1));
            }}
          />
        )}
      </div>
    </div>
  );
}

export function MessageBodyEditor({ mode, value, onChange, variables }: MessageBodyEditorProps) {
  if (mode === 'document') {
    return <TemplateEditor value={value} variables={variables} onChange={onChange} />;
  }
  if (mode === 'canvas') {
    return <CanvasEditor value={value} variables={variables} onChange={onChange} />;
  }
  return <BlocksEditor value={value} variables={variables} onChange={onChange} />;
}
