'use client';
import { requestActionImpact } from '@/components/admin/actionImpactRequest';

import { useEffect, useMemo, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  MAX_TICKET_HTML_LENGTH,
  MAX_TICKET_TEXT_LENGTH,
  htmlToPlainText,
} from '@/lib/ticket-content';
import {
  Bold,
  CodeXml,
  Italic,
  List,
  ListOrdered,
  Link2,
  Quote,
  RemoveFormatting,
  Strikethrough,
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  maxLength?: number;
  ariaLabel?: string;
  /** Called with image files pasted or dropped into the editor so the parent can stage them as evidence. Images are never inlined into the HTML. */
  onImageFiles?: (files: File[]) => void;
}

function collectImageFiles(transfer: DataTransfer | null): File[] {
  if (!transfer) return [];
  const files: File[] = [];
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file && file.type.startsWith('image/')) files.push(file);
  }
  if (files.length === 0) {
    for (const file of Array.from(transfer.files ?? [])) {
      if (file.type.startsWith('image/')) files.push(file);
    }
  }
  return files;
}

/**
 * WYSIWYG composer for support tickets. Emits HTML through onChange; the
 * server sanitizes it before storage (lib/ticket-content.ts is the only
 * trusted pipeline). Image paste/drop is delegated to the parent as staged
 * evidence files - nothing is embedded in the document.
 */
export function RichTextEditor({
  value,
  onChange,
  disabled = false,
  maxLength = MAX_TICKET_TEXT_LENGTH,
  ariaLabel,
  onImageFiles,
}: RichTextEditorProps) {
  const onImageFilesRef = useRef(onImageFiles);
  const acceptedHtmlRef = useRef(value || '');

  useEffect(() => {
    onImageFilesRef.current = onImageFiles;
  }, [onImageFiles]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [3, 4] } }),
      Link.configure({ openOnClick: false, autolink: true }),
    ],
    content: value || '',
    editable: !disabled,
    immediatelyRender: false,
    onUpdate: ({ editor: current }) => {
      const next = current.getHTML();
      if (next.length > MAX_TICKET_HTML_LENGTH || htmlToPlainText(next).length > maxLength) {
        current.commands.setContent(acceptedHtmlRef.current, { emitUpdate: false });
        return;
      }
      acceptedHtmlRef.current = next;
      onChange(next);
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none min-h-[150px] px-3 py-2 text-foreground focus:outline-none',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        role: 'textbox',
        'aria-multiline': 'true',
      },
      handlePaste: (_view, event) => {
        const handler = onImageFilesRef.current;
        if (!handler) return false;
        const files = collectImageFiles(event.clipboardData);
        if (files.length === 0) return false;
        event.preventDefault();
        handler(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const handler = onImageFilesRef.current;
        if (!handler) return false;
        const files = collectImageFiles(event.dataTransfer);
        if (files.length === 0) return false;
        event.preventDefault();
        handler(files);
        return true;
      },
    },
  });

  // Keep external resets (clearing the form after submit) in sync.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const next = value || '';
    if (next === editor.getHTML()) return;
    acceptedHtmlRef.current = next;
    editor.commands.setContent(next, { emitUpdate: false });
  }, [editor, value]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.setEditable(!disabled);
  }, [editor, disabled]);

  // The counter is derived per render: parents mirror onChange back into
  // value, so the live document and `value` stay in lock-step.
  const textLength = useMemo(
    () => (editor && !editor.isDestroyed ? editor.getText().length : htmlToPlainText(value || '').length),
    [editor, value]
  );

  if (!editor) {
    return <div className="min-h-[180px] animate-pulse rounded-md border border-input bg-muted" />;
  }

  const toolbarButton = (
    label: string,
    icon: React.ReactNode,
    active: boolean,
    action: () => void
  ) => (
    <Button
      key={label}
      type="button"
      variant="ghost"
      size="icon-sm"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={action}
      className={cn(active && 'bg-accent text-accent-foreground')}
    >
      {icon}
    </Button>
  );

  return (
    <div className="space-y-1">
      <div className="overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring">
        <div className="flex flex-wrap items-center gap-0.5 border-b border-input bg-muted/50 px-1 py-1">
          {toolbarButton('Bold', <Bold className="h-4 w-4" />, editor.isActive('bold'), () =>
            editor.chain().focus().toggleBold().run()
          )}
          {toolbarButton('Italic', <Italic className="h-4 w-4" />, editor.isActive('italic'), () =>
            editor.chain().focus().toggleItalic().run()
          )}
          {toolbarButton('Strikethrough', <Strikethrough className="h-4 w-4" />, editor.isActive('strike'), () =>
            editor.chain().focus().toggleStrike().run()
          )}
          <span className="mx-1 h-5 w-px bg-border" />
          {toolbarButton('Bullet list', <List className="h-4 w-4" />, editor.isActive('bulletList'), () =>
            editor.chain().focus().toggleBulletList().run()
          )}
          {toolbarButton('Numbered list', <ListOrdered className="h-4 w-4" />, editor.isActive('orderedList'), () =>
            editor.chain().focus().toggleOrderedList().run()
          )}
          <span className="mx-1 h-5 w-px bg-border" />
          {toolbarButton('Link', <Link2 className="h-4 w-4" />, editor.isActive('link'), async () => {
            if (editor.isActive('link')) {
              editor.chain().focus().unsetLink().run();
              return;
            }
            const decision = await requestActionImpact({ title: 'Insert support link', description: 'Add a reviewed link to the selected support content.', input: { label: 'Link URL', placeholder: 'https://…', required: true }, confirmLabel: 'Insert link' });
            if (decision.confirmed && decision.value) editor.chain().focus().setLink({ href: decision.value }).run();
          })}
          {toolbarButton('Code block', <CodeXml className="h-4 w-4" />, editor.isActive('codeBlock'), () =>
            editor.chain().focus().toggleCodeBlock().run()
          )}
          {toolbarButton('Quote', <Quote className="h-4 w-4" />, editor.isActive('blockquote'), () =>
            editor.chain().focus().toggleBlockquote().run()
          )}
          <span className="mx-1 h-5 w-px bg-border" />
          {toolbarButton('Clear formatting', <RemoveFormatting className="h-4 w-4" />, false, () =>
            editor.chain().focus().unsetAllMarks().clearNodes().run()
          )}
        </div>

        <EditorContent editor={editor} />
      </div>

      <p className="text-right text-xs tabular-nums text-muted-foreground" aria-live="polite">
        {textLength.toLocaleString()} / {maxLength.toLocaleString()}
      </p>
    </div>
  );
}
