'use client';

import dynamic from 'next/dynamic';

const CodeMirrorViewer = dynamic(() => import('./ReadOnlyCodeViewerClient'), {
  ssr: false,
  loading: () => <div className="h-full min-h-0 border bg-background" />,
});

export function ReadOnlyCodeViewer({ value, language, wrap = false }: { value: string; language: string; wrap?: boolean }) {
  return <CodeMirrorViewer value={value} language={language} wrap={wrap} />;
}
