'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LocalizedDateTime } from '@/components/support/LocalizedDateTime';
import { PAGE_APPEARANCE_REGISTRY, type PageAppearanceId } from '@/lib/appearance';

import type { AppearanceHistoryItem } from './AppearancePanelState';

interface AppearanceHistorySectionProps {
  history: AppearanceHistoryItem[];
  pageInfo: { total: number; nextCursor: string | null; hasNext: boolean };
  saving: boolean;
  onLoadMore: (cursor: string) => void;
  onRestoreManaged: (page: PageAppearanceId, version: number) => void;
  onRestoreRevision: (revisionId: string) => void;
}

export default function AppearanceHistorySection({ history, pageInfo, saving, onLoadMore, onRestoreManaged, onRestoreRevision }: AppearanceHistorySectionProps) {
  return (
    <Card>
      <CardHeader><CardTitle>Page revision history</CardTitle><CardDescription>Restore any published snapshot as a new draft; history itself is immutable.</CardDescription></CardHeader>
      <CardContent><div className="divide-y rounded-lg border">{history.map((revision) => <div key={`${revision.source}:${revision.id}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"><span className="font-medium">{PAGE_APPEARANCE_REGISTRY[revision.key as PageAppearanceId]?.label ?? revision.key}{revision.version ? ` · v${revision.version}` : ''} <Badge variant="outline">{revision.status}</Badge></span><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{revision.actor} · <LocalizedDateTime value={revision.createdAt} /></span>{revision.source === 'managed_page' && revision.version ? <Button variant="ghost" size="sm" disabled={saving} onClick={() => onRestoreManaged(revision.key as PageAppearanceId, revision.version!)}>Restore as draft</Button> : <Button variant="ghost" size="sm" disabled={saving} onClick={() => onRestoreRevision(revision.id)}>Restore</Button>}</div></div>)}{history.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No appearance revisions yet.</p>}</div><div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{history.length} of {pageInfo.total} revisions</span>{pageInfo.hasNext && pageInfo.nextCursor && <Button variant="outline" size="sm" onClick={() => onLoadMore(pageInfo.nextCursor!)}>Load more</Button>}</div></CardContent>
    </Card>
  );
}
