'use client';

import { useEffect, useRef } from 'react';

interface CodeMirrorModules {
  EditorState: typeof import('@codemirror/state').EditorState;
  EditorView: typeof import('@codemirror/view').EditorView;
  drawSelection: typeof import('@codemirror/view').drawSelection;
  highlightActiveLine: typeof import('@codemirror/view').highlightActiveLine;
  highlightActiveLineGutter: typeof import('@codemirror/view').highlightActiveLineGutter;
  keymap: typeof import('@codemirror/view').keymap;
  lineNumbers: typeof import('@codemirror/view').lineNumbers;
  defaultKeymap: typeof import('@codemirror/commands').defaultKeymap;
  searchKeymap: typeof import('@codemirror/search').searchKeymap;
  syntaxHighlighting: typeof import('@codemirror/language').syntaxHighlighting;
  defaultHighlightStyle: typeof import('@codemirror/language').defaultHighlightStyle;
  javascript: typeof import('@codemirror/lang-javascript').javascript;
  json: typeof import('@codemirror/lang-json').json;
  html: typeof import('@codemirror/lang-html').html;
  css: typeof import('@codemirror/lang-css').css;
  markdown: typeof import('@codemirror/lang-markdown').markdown;
}

async function loadCodeMirror(): Promise<CodeMirrorModules> {
  const [state, view, commands, search, language, javascriptModule, jsonModule, htmlModule, cssModule, markdownModule] = await Promise.all([
    import('@codemirror/state'), import('@codemirror/view'), import('@codemirror/commands'), import('@codemirror/search'), import('@codemirror/language'), import('@codemirror/lang-javascript'), import('@codemirror/lang-json'), import('@codemirror/lang-html'), import('@codemirror/lang-css'), import('@codemirror/lang-markdown'),
  ]);
  return { ...state, ...view, ...commands, ...search, ...language, ...javascriptModule, ...jsonModule, ...htmlModule, ...cssModule, ...markdownModule };
}

function languageExtension(language: string, modules: CodeMirrorModules) {
  if (language === 'typescript') return modules.javascript({ typescript: true, jsx: true });
  if (language === 'javascript') return modules.javascript({ jsx: true });
  if (language === 'json') return modules.json();
  if (language === 'html') return modules.html();
  if (language === 'css' || language === 'scss') return modules.css();
  if (language === 'markdown') return modules.markdown();
  return [];
}

export default function ReadOnlyCodeViewerClient({ value, language, wrap }: { value: string; language: string; wrap: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let destroy = () => {};
    void loadCodeMirror().then((modules) => {
      if (!host.current || disposed) return;
      const view = new modules.EditorView({ parent: host.current, state: modules.EditorState.create({ doc: value, extensions: [
        modules.lineNumbers(), modules.highlightActiveLineGutter(), modules.drawSelection(), modules.highlightActiveLine(), modules.syntaxHighlighting(modules.defaultHighlightStyle, { fallback: true }), modules.keymap.of([...modules.defaultKeymap, ...modules.searchKeymap]), modules.EditorState.readOnly.of(true), modules.EditorView.editable.of(false), ...(wrap ? [modules.EditorView.lineWrapping] : []), languageExtension(language, modules), modules.EditorView.theme({ '&': { height: '100%', backgroundColor: 'transparent', fontSize: '12px' }, '.cm-scroller': { fontFamily: 'var(--font-geist-mono), ui-monospace, monospace', overflow: 'auto' }, '.cm-gutters': { backgroundColor: 'color-mix(in srgb, var(--muted) 55%, transparent)', borderRight: '1px solid var(--border)' }, '.cm-content': { padding: '12px 0' } }),
      ] }) });
      destroy = () => view.destroy();
    });
    return () => { disposed = true; destroy(); };
  }, [language, value, wrap]);
  return <div ref={host} className="h-full min-h-0 overflow-hidden border bg-background" />;
}
