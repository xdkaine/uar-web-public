import { Badge } from '@/components/ui/badge';
import type { AccountOwnershipSummary } from '@/lib/account-ownership';
import {
  ownershipPresentation,
  type OwnershipTone,
} from './accountOwnershipPresentation';

const TONE_CLASSES: Record<OwnershipTone, string> = {
  positive: 'border-teal-300 bg-teal-50 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-200',
  muted: 'border-border bg-muted/30 text-muted-foreground',
  danger: 'border-destructive/40 bg-destructive/5 text-destructive',
};

interface AccountOwnershipDetailsProps {
  ownership?: AccountOwnershipSummary | null;
  compact?: boolean;
  className?: string;
}

/** Presents server-resolved portal provenance only; it never infers an owner. */
export function AccountOwnershipDetails({ ownership, compact = false, className = '' }: AccountOwnershipDetailsProps) {
  const presentation = ownershipPresentation(ownership);
  const systems = ownership?.expectedSystems;
  const requestLink = ownership?.requestId && ownership.requestHref
    ? { href: ownership.requestHref, label: 'View request' }
    : null;
  const batchLink = ownership?.batchRunId && ownership.batchHref
    ? { href: ownership.batchHref, label: 'View batch' }
    : null;

  return (
    <section aria-label="Portal ownership" className={`space-y-2 ${className}`}>
      {!compact && <h3 className="text-lg font-semibold text-foreground">Portal ownership</h3>}
      <div className={compact ? 'space-y-1.5' : 'rounded-lg border bg-muted/30 p-4 space-y-3'}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={TONE_CLASSES[presentation.tone]}>{presentation.label}</Badge>
          {systems?.map((system) => <Badge key={system} variant="secondary" className="text-[11px]">Expected {system}</Badge>)}
        </div>
        {presentation.primaryId && <OwnershipIdentifier label={presentation.primaryLabel!} value={presentation.primaryId} link={presentation.primaryLabel === 'Request ID' ? requestLink : batchLink} />}
        {presentation.secondaryId && <OwnershipIdentifier label={presentation.secondaryLabel!} value={presentation.secondaryId} link={presentation.secondaryLabel === 'Batch run ID' ? batchLink : null} />}
        {presentation.label === 'No portal owner' && <p className="text-sm text-muted-foreground">This account has no recorded portal owner.</p>}
        {presentation.label === 'Ownership unavailable' && <p className="text-sm text-muted-foreground">This response did not include portal ownership evidence.</p>}
      </div>
    </section>
  );
}

function OwnershipIdentifier({ label, value, link }: { label: string; value: string; link: { href: string; label: string } | null }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><span className="text-muted-foreground">{label}</span><code className="break-all rounded bg-background/70 px-1.5 py-0.5 text-xs text-foreground">{value}</code>{link && <a href={link.href} className="text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">{link.label}</a>}</div>;
}
