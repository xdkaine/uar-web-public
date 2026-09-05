'use client';

import Link from 'next/link';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { buildSandboxDocument, type ManagedPageDocument } from '@/lib/appearance-pages';
import { cn } from '@/lib/utils';

export function ManagedPageRegion({ document, preview = false }: { document?: ManagedPageDocument | null; preview?: boolean }) {
  if (!document) return null;
  if (document.mode === 'advanced') {
    return (
      <iframe
        title={preview ? 'Managed page preview' : 'Managed page content'} sandbox="allow-scripts" referrerPolicy="no-referrer"
        srcDoc={buildSandboxDocument(document)}
        className="min-h-[280px] w-full rounded-lg border border-border bg-background"
      />
    );
  }
  return (
    <div className="space-y-4">
      {document.blocks.map((block) => {
        if (block.type === 'richText' || block.type === 'serviceStory') return <section key={block.id} className="border-l-4 border-violet-500 pl-4"><h2 className="font-semibold">{'title' in block ? block.title : 'Overview'}</h2><p className="whitespace-pre-wrap text-sm text-muted-foreground">{block.body}</p></section>;
        if (block.type === 'notice') return <Alert key={block.id} className={cn(block.tone === 'warning' && 'border-amber-500 bg-amber-50 dark:bg-amber-950', block.tone === 'success' && 'border-teal-500 bg-teal-50 dark:bg-teal-950')}><AlertDescription>{block.body}</AlertDescription></Alert>;
        if (block.type === 'actionCards') return <section key={block.id}><h2 className="mb-3 font-semibold">{block.title}</h2><div className="grid gap-3 sm:grid-cols-2">{block.items.map((item) => <Link key={item.href + item.label} href={item.href} className="border-l-4 border-blue-500 bg-muted/40 p-3 hover:bg-muted"><strong>{item.label}</strong><p className="text-xs text-muted-foreground">{item.description}</p></Link>)}</div></section>;
        if (block.type === 'workflowShowcase') return <section key={block.id}><h2 className="mb-3 font-semibold">{block.title}</h2><ol className="flex flex-wrap gap-2">{block.steps.map((step, index) => <li key={`${step}-${index}`} className="flex items-center gap-2 text-sm"><span className="grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-xs text-white">{index + 1}</span>{step}{index < block.steps.length - 1 && <span className="text-muted-foreground">→</span>}</li>)}</ol></section>;
        if (block.type === 'faq') return <section key={block.id}><h2 className="mb-2 font-semibold">{block.title}</h2>{block.items.map((item) => <details key={item.question} className="border-b py-2"><summary className="cursor-pointer text-sm font-medium">{item.question}</summary><p className="pt-2 text-sm text-muted-foreground">{item.answer}</p></details>)}</section>;
        return null;
      })}
    </div>
  );
}
