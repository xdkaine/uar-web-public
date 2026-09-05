'use client';

import { ChevronDown, ChevronRight, MailCheck, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { MessageTemplate } from './message-panel-types';

const CATEGORY_ORDER = ['requests', 'tickets', 'accounts', 'lifecycle', 'system', 'notifications'] as const;
const CATEGORY_META: Record<string, { title: string; icon: React.ReactNode }> = {
  requests: { title: 'Access Requests', icon: <MailCheck className="h-4 w-4 text-primary" /> },
  tickets: { title: 'Support Tickets', icon: <Users className="h-4 w-4 text-primary" /> },
};

export function MessageTemplateNavigator({ templates, selectedKey, collapsedCategories, isDirty, onSelect, onToggleCategory }: {
  templates: MessageTemplate[];
  selectedKey: string | null;
  collapsedCategories: ReadonlySet<string>;
  isDirty: (template: MessageTemplate) => boolean;
  onSelect: (key: string) => void;
  onToggleCategory: (category: string) => void;
}) {
  const grouped = new Map<string, MessageTemplate[]>();
  for (const template of templates) {
    const group = grouped.get(template.category) ?? [];
    group.push(template);
    grouped.set(template.category, group);
  }
  const categories = [...CATEGORY_ORDER, ...Array.from(grouped.keys()).filter((category) => !(CATEGORY_ORDER as readonly string[]).includes(category))];
  return (
    <div className="space-y-2">
      {categories.map((category) => {
        const meta = CATEGORY_META[category] ?? { title: category, icon: <Users className="h-4 w-4 text-primary" /> };
        const items = grouped.get(category) ?? [];
        const collapsed = collapsedCategories.has(category);
        const dirtyCount = items.filter(isDirty).length;
        return (
          <div key={category} className="overflow-hidden rounded-lg border border-border bg-card">
            <button type="button" aria-expanded={!collapsed} onClick={() => onToggleCategory(category)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold hover:bg-muted/60">
              {collapsed ? <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
              {meta.icon}<span className="min-w-0 flex-1 truncate">{meta.title}</span>
              {dirtyCount > 0 && <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">{dirtyCount} unsaved</span>}
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </button>
            {!collapsed && <ul className="border-t border-border p-1">
              {items.length === 0 && <li className="px-3 py-2 text-xs italic text-muted-foreground">No templates in this category yet.</li>}
              {items.map((template) => <TemplateItem key={template.key} template={template} selected={template.key === selectedKey} dirty={isDirty(template)} onSelect={onSelect} />)}
            </ul>}
          </div>
        );
      })}
    </div>
  );
}

function TemplateItem({ template, selected, dirty, onSelect }: { template: MessageTemplate; selected: boolean; dirty: boolean; onSelect: (key: string) => void }) {
  return <li>
    <button type="button" onClick={() => onSelect(template.key)} aria-current={selected} className={cn('w-full rounded-md px-2.5 py-2 text-left transition-colors', selected ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/70')}>
      <span className="flex items-center gap-1.5"><span className="min-w-0 flex-1 truncate text-sm font-medium">{template.label}</span>{dirty && <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" title="Unsaved changes" aria-label="Unsaved changes" />}</span>
      <span className="mt-0.5 flex items-center gap-1.5"><code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">{template.key}</code>{template.customized && <Badge variant="secondary">customized</Badge>}</span>
    </button>
  </li>;
}
