'use client';

import { useEffect, useRef, useState } from 'react';

type Language = 'html' | 'css' | 'javascript' | 'markdown';

type EditorViewInstance = {
  state: { doc: { toString: () => string; length: number } };
  dispatch: (transaction: { changes: { from: number; to: number; insert: string } }) => void;
  destroy: () => void;
};

export function CodeEditor({
  value,
  onChange,
  language,
  minHeight = 260,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  language: Language;
  minHeight?: number;
  ariaLabel: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorViewInstance | null>(null);
  const onChangeRef = useRef(onChange);
  const initialValue = useRef(value);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  useEffect(() => {
    if (!host.current) return;
    let cancelled = false;
    let editor: EditorViewInstance | null = null;
    setLoadError(false);

    void Promise.all([
      import('@codemirror/state'),
      import('@codemirror/view'),
      import('@codemirror/commands'),
      import('@codemirror/search'),
      import('@codemirror/lang-html'),
      import('@codemirror/lang-css'),
      import('@codemirror/lang-javascript'),
      import('@codemirror/lang-markdown'),
    ]).then(([
      { EditorState },
      { EditorView, keymap, lineNumbers },
      { defaultKeymap, history, historyKeymap, indentWithTab },
      { searchKeymap },
      { html },
      { css },
      { javascript },
      { markdown },
    ]) => {
      if (cancelled || !host.current) return;
      const languageExtension = language === 'css'
        ? css()
        : language === 'javascript'
          ? javascript({ typescript: false })
          : language === 'markdown'
            ? markdown()
            : html();
      editor = new EditorView({
        parent: host.current,
        state: EditorState.create({
          doc: initialValue.current,
          extensions: [
            lineNumbers(), history(), languageExtension, EditorView.lineWrapping,
            keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
            EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
            EditorView.theme({
              '&': { minHeight: `${minHeight}px`, background: 'transparent' },
              '.cm-scroller': { fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', fontSize: '13px' },
              '.cm-content': { minHeight: `${minHeight}px`, padding: '12px 0' },
              '.cm-gutters': { background: 'color-mix(in oklab, var(--muted) 55%, transparent)', border: 'none' },
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) onChangeRef.current(update.state.doc.toString());
            }),
          ],
        }),
      });
      view.current = editor;
    }).catch(() => {
      if (!cancelled) setLoadError(true);
    });

    return () => {
      cancelled = true;
      editor?.destroy();
      if (view.current === editor) view.current = null;
    };
    // A language change intentionally recreates the editor mode.
  }, [ariaLabel, language, minHeight]);

  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  if (loadError) {
    return (
      <textarea
        aria-label={ariaLabel}
        className="min-h-48 w-full rounded-md border border-input bg-background p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ minHeight }}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return <div ref={host} className="overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring" />;
}
