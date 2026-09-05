'use client';
import { requestActionImpact } from '@/components/admin/actionImpactRequest';

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { isBasicMessageEditorRoundTripSafe } from '@/lib/messages/editor-state';
import { syncMessageEditorContent } from './templateEditorContent';
import { CodeEditor } from './CodeEditor';
import {
  Bold,
  Italic,
  Strikethrough,
  Heading2,
  List,
  ListOrdered,
  Link2,
  Code,
  Undo2,
  Redo2,
  CodeXml,
  ShieldAlert,
} from 'lucide-react';

export interface TemplateVariableOption {
  name: string;
  description: string;
}

interface TemplateEditorProps {
  value: string;
  onChange: (next: string) => void;
  variables: TemplateVariableOption[];
  placeholder?: string;
}

type SuggestionState = {
  from: number;
  query: string;
} | null;

const TRIGGER_PATTERN = /(\{\{|\{|\B@)([\w.]*)$/;

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
    onClick={action}
    className={cn(active && 'bg-accent text-accent-foreground')}
  >
    {icon}
  </Button>
);

/**
 * Rich-text template editor (ADR-0005 message templates). WYSIWYG via Tiptap
 * with {{variable}} / @ autocomplete, plus a raw HTML source toggle for
 * power users. Emits HTML through onChange; unknown tokens stay visible so
 * mistakes surface instead of silently rendering blank.
 */
export function TemplateEditor({ value, onChange, variables, placeholder }: TemplateEditorProps) {
  const [sourceMode, setSourceMode] = useState(false);
  const [preserveAsCustomHtml, setPreserveAsCustomHtml] = useState(false);
  const [suggestion, setSuggestion] = useState<SuggestionState>(null);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const editorRef = useRef<HTMLDivElement>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
    ],
    content: value || '',
    immediatelyRender: false,
    onCreate: ({ editor: current }) => {
      setPreserveAsCustomHtml(!isBasicMessageEditorRoundTripSafe(value, current.getHTML()));
    },
    onUpdate: ({ editor: current }) => {
      onChange(current.getHTML());
      const { from, empty } = current.state.selection;
      if (!empty && !current.state.selection.$from.sameParent(current.state.selection.$to)) {
        setSuggestion(null);
        return;
      }
      const textBefore = current.state.doc.textBetween(
        Math.max(0, from - 40),
        from,
        '\n'
      );
      const match = TRIGGER_PATTERN.exec(textBefore);
      if (match) {
        setSuggestion({
          from: from - (match[0]?.length ?? 0),
          query: match[2] ?? '',
        });
        setSelectedSuggestion(0);
      } else {
        setSuggestion(null);
      }
    },
    editorProps: {
      attributes: {
        class:
          'prose prose-sm dark:prose-invert max-w-none min-h-[160px] rounded-md border border-input bg-background px-3 py-2 focus:outline-none',
        'data-placeholder': placeholder ?? '',
      },
    },
  });

  // Keep external resets (e.g. after save/reload) in sync when not focused.
  useEffect(() => {
    if (!editor || sourceMode) return;
    if (editor.isFocused) return;
    if (editor.getHTML() !== value) {
      const safeForBasic = syncMessageEditorContent(editor, value);
      setPreserveAsCustomHtml(!safeForBasic);
      return;
    }
    setPreserveAsCustomHtml(!isBasicMessageEditorRoundTripSafe(value, editor.getHTML()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const filteredSuggestions = useMemo(
    () =>
      suggestion
        ? variables.filter((variable) =>
            variable.name.toLowerCase().includes(suggestion.query.toLowerCase())
          )
        : [],
    [suggestion, variables]
  );

  const insertVariable = (name: string) => {
    if (!editor || !suggestion) return;
    editor
      .chain()
      .focus()
      .deleteRange({ from: suggestion.from, to: editor.state.selection.from })
      .insertContent(`{{${name}}}`)
      .run();
    setSuggestion(null);
  };

  const insertVariableFromKeyboard = useEffectEvent(insertVariable);

  useEffect(() => {
    if (!suggestion || filteredSuggestions.length === 0) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSelectedSuggestion((prev) => (prev + 1) % filteredSuggestions.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSelectedSuggestion((prev) => (prev - 1 + filteredSuggestions.length) % filteredSuggestions.length);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        const chosen = filteredSuggestions[selectedSuggestion];
        if (chosen) insertVariableFromKeyboard(chosen.name);
      } else if (event.key === 'Escape') {
        setSuggestion(null);
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [suggestion, filteredSuggestions, selectedSuggestion]);

  if (!editor) {
    return <div className="min-h-[160px] animate-pulse rounded-md border border-input bg-muted" />;
  }

  if (preserveAsCustomHtml) {
    return (
      <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div>
              <p className="text-sm font-semibold">Custom HTML preserved</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Basic rich text cannot represent this email without changing its layout. The original source remains intact and editable here.
              </p>
            </div>
          </div>
          <Badge variant="outline">Lossless fallback</Badge>
        </div>
        <CodeEditor value={value} onChange={onChange} language="html" minHeight={320} ariaLabel="Preserved message HTML" />
      </div>
    );
  }


  if (sourceMode) {
    return (
      <div className="space-y-2">
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setSourceMode(false);
              setPreserveAsCustomHtml(!syncMessageEditorContent(editor, value));
            }}
          >
            Visual editor
          </Button>
        </div>
        <CodeEditor value={value} onChange={onChange} language="html" minHeight={260} ariaLabel="Message HTML source" />
        <p className="text-xs text-muted-foreground">
          Raw HTML source. Type <code>{'{{'}</code> or <code>@</code> in the visual editor for a
          variable menu.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1" ref={editorRef}>
      <div className="flex flex-wrap items-center gap-0.5 rounded-t-md border border-input border-b-0 bg-muted/50 px-1 py-1">
        {toolbarButton('Bold', <Bold className="h-4 w-4" />, editor.isActive('bold'), () =>
          editor.chain().focus().toggleBold().run()
        )}
        {toolbarButton('Italic', <Italic className="h-4 w-4" />, editor.isActive('italic'), () =>
          editor.chain().focus().toggleItalic().run()
        )}
        {toolbarButton('Strikethrough', <Strikethrough className="h-4 w-4" />, editor.isActive('strike'), () =>
          editor.chain().focus().toggleStrike().run()
        )}
        {toolbarButton('Heading', <Heading2 className="h-4 w-4" />, editor.isActive('heading', { level: 2 }), () =>
          editor.chain().focus().toggleHeading({ level: 2 }).run()
        )}
        {toolbarButton('Bullet list', <List className="h-4 w-4" />, editor.isActive('bulletList'), () =>
          editor.chain().focus().toggleBulletList().run()
        )}
        {toolbarButton('Numbered list', <ListOrdered className="h-4 w-4" />, editor.isActive('orderedList'), () =>
          editor.chain().focus().toggleOrderedList().run()
        )}
        {toolbarButton('Code', <Code className="h-4 w-4" />, editor.isActive('code'), () =>
          editor.chain().focus().toggleCode().run()
        )}
        {toolbarButton('Link', <Link2 className="h-4 w-4" />, editor.isActive('link'), async () => {
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run();
            return;
          }
          const decision = await requestActionImpact({ title: 'Insert template link', description: 'Add a reviewed link to the selected message content.', input: { label: 'Link URL', placeholder: 'https://…', required: true }, confirmLabel: 'Insert link' });
          if (decision.confirmed && decision.value) editor.chain().focus().setLink({ href: decision.value }).run();
        })}
        <span className="mx-1 h-5 w-px bg-border" />
        {toolbarButton('Undo', <Undo2 className="h-4 w-4" />, false, () => editor.chain().focus().undo().run())}
        {toolbarButton('Redo', <Redo2 className="h-4 w-4" />, false, () => editor.chain().focus().redo().run())}
        <span className="ml-auto">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSourceMode(true)}
            title="Edit raw HTML"
          >
            <CodeXml className="mr-1.5 h-4 w-4" /> Source
          </Button>
        </span>
      </div>

      <div className="relative">
        <EditorContent editor={editor} />
        {suggestion && filteredSuggestions.length > 0 && (
          <div
            role="listbox"
            aria-label="Template variables"
            className="absolute z-50 mt-1 max-h-56 w-72 overflow-auto rounded-lg border border-border bg-popover shadow-xl"
          >
            {filteredSuggestions.map((variable, index) => (
              <button
                key={variable.name}
                type="button"
                role="option"
                aria-selected={index === selectedSuggestion}
                onMouseDown={(event) => {
                  event.preventDefault(); // keep editor focus
                  insertVariable(variable.name);
                }}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent',
                  index === selectedSuggestion && 'bg-accent'
                )}
              >
                <code className="font-mono text-xs">{`{{${variable.name}}}`}</code>
                <span className="text-xs text-muted-foreground">{variable.description}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Type <code>{'{{'}</code> or <code>@</code> to insert a placeholder. Arrow keys navigate;
        Enter selects.
      </p>
    </div>
  );
}
