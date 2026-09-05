import { Check, UserCog } from 'lucide-react';
import { cn } from '@/lib/utils';

export function OptionButton({ selected, onClick, icon: Icon, title, description }: { selected: boolean; onClick: () => void; icon?: typeof UserCog; title: React.ReactNode; description?: string }) {
  return <button type="button" aria-pressed={selected} onClick={onClick} className={cn('flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all', selected ? 'border-primary bg-accent shadow-sm ring-1 ring-primary/30' : 'border-border bg-card hover:border-muted-foreground/40 hover:bg-accent/40')}>
    {Icon && <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-md', selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}><Icon className="h-4.5 w-4.5" /></span>}
    <span className="min-w-0"><span className="flex flex-wrap items-center gap-2 text-sm font-semibold text-foreground">{title}{selected && <Check className="h-4 w-4 text-primary" />}</span>{description && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{description}</span>}</span>
  </button>;
}
