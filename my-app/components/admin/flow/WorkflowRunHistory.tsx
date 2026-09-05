'use client';

import { ClientLocalDate } from '@/components/admin/ClientLocalDate';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { StoredRun } from './workflowPanelTypes';

export function WorkflowRunHistory({ runs }: { runs: StoredRun[] }) {
  return <Card><CardHeader className="pb-2"><CardTitle className="text-base">Recent runs</CardTitle></CardHeader><CardContent className="pt-0">{runs.length === 0 ? <p className="text-sm text-muted-foreground">No runs yet.</p> : <ul className="space-y-1.5">{runs.map((run) => {
    const failedNode = run.nodeOutcomes?.find((outcome) => outcome.status === 'failed');
    return <li key={run.id} className="flex flex-wrap items-center gap-2 rounded border px-2.5 py-1.5 text-xs"><Badge variant={run.status === 'succeeded' ? 'default' : run.status === 'failed' ? 'destructive' : 'secondary'}>{run.status}</Badge><span className="font-mono truncate flex-1" title={run.eventKey}>{run.eventKey}</span><span className="text-muted-foreground shrink-0"><ClientLocalDate value={run.startedAt} /></span>{run.error && <span className="text-destructive truncate max-w-[200px]" title={run.error}>{run.error}</span>}{failedNode && <span className="basis-full pl-0 text-destructive">Failed node: {failedNode.nodeId}{failedNode.error ? ` — ${failedNode.error}` : ''}</span>}</li>;
  })}</ul>}</CardContent></Card>;
}
