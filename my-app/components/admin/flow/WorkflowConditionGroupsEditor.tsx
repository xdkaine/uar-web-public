'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { ConditionComparisonOp } from '@/lib/flow/catalog';
import { Trash2 } from 'lucide-react';
import type { ConditionComparisonDraft, ConditionGroupDraft } from './workflowPanelTypes';

const CONDITION_OP_OPTIONS: Array<{ value: ConditionComparisonOp; label: string }> = [
  { value: 'equals', label: 'is equal to' },
  { value: 'contains', label: 'contains' },
  { value: 'in', label: 'is one of' },
];

export function ConditionGroupsEditor({
  groups,
  contextFields,
  onChange,
}: {
  groups: ConditionGroupDraft[];
  contextFields: Array<{ key: string; label: string }>;
  onChange: (next: ConditionGroupDraft[]) => void;
}) {
  const fieldOptions = contextFields.length > 0 ? contextFields : [];
  const updateGroup = (groupIndex: number, patch: Partial<ConditionGroupDraft>) => {
    onChange(groups.map((group, index) => (index === groupIndex ? { ...group, ...patch } : group)));
  };
  const updateComparison = (groupIndex: number, comparisonIndex: number, patch: Partial<ConditionComparisonDraft>) => {
    onChange(groups.map((group, index) => index === groupIndex ? {
      ...group,
      comparisons: group.comparisons.map((comparison, cIndex) => cIndex === comparisonIndex ? { ...comparison, ...patch } : comparison),
    } : group));
  };

  return (
    <div className="space-y-2 rounded-md border border-dashed p-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Advanced groups</p>
        <button type="button" onClick={() => onChange([])} className="text-xs text-primary underline-offset-2 hover:underline">Use simple comparison</button>
      </div>
      <p className="text-xs text-muted-foreground">Groups combine with AND; each group matches all or any of its comparisons. Comparisons are case-insensitive.</p>
      {groups.map((group, groupIndex) => (
        <div key={groupIndex} className="space-y-2 rounded border bg-muted/20 p-2">
          <div className="flex items-center gap-2">
            <Label htmlFor={`condition-group-${groupIndex}-match`} className="text-xs">Match</Label>
            <select id={`condition-group-${groupIndex}-match`} className="flex h-7 flex-1 rounded-md border border-input bg-transparent px-2 text-xs" value={group.match} onChange={(event) => updateGroup(groupIndex, { match: event.target.value === 'any' ? 'any' : 'all' })}>
              <option value="all">ALL of these</option><option value="any">ANY of these</option>
            </select>
            <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => onChange(groups.filter((_, index) => index !== groupIndex))}><Trash2 className="h-3.5 w-3.5" /></Button>
          </div>
          {group.comparisons.map((comparison, comparisonIndex) => (
            <div key={comparisonIndex} className="space-y-1 rounded border px-2 py-1.5">
              <div className="flex items-center gap-1">
                <select aria-label={`Condition comparison ${comparisonIndex + 1} field`} className="flex h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-1 text-xs" value={comparison.field} onChange={(event) => updateComparison(groupIndex, comparisonIndex, { field: event.target.value })}>
                  <option value="">Field…</option>{fieldOptions.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                </select>
                <select aria-label={`Condition comparison ${comparisonIndex + 1} operator`} className="flex h-7 shrink-0 rounded-md border border-input bg-transparent px-1 text-xs" value={comparison.op} onChange={(event) => updateComparison(groupIndex, comparisonIndex, { op: event.target.value as ConditionComparisonOp, ...(event.target.value === 'in' ? { value: [''] } : { value: '' }) })}>
                  {CONDITION_OP_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <Button size="sm" variant="ghost" className="h-7 shrink-0 px-1.5" onClick={() => updateGroup(groupIndex, { comparisons: group.comparisons.filter((_, cIndex) => cIndex !== comparisonIndex) })}><Trash2 className="h-3 w-3" /></Button>
              </div>
              {comparison.op === 'in' ? <Input className="h-7 text-xs" placeholder="value1, value2, …" value={Array.isArray(comparison.value) ? comparison.value.join(', ') : ''} onChange={(event) => updateComparison(groupIndex, comparisonIndex, { value: event.target.value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0) })} /> : <Input className="h-7 text-xs" placeholder="Value" value={typeof comparison.value === 'string' ? comparison.value : ''} onChange={(event) => updateComparison(groupIndex, comparisonIndex, { value: event.target.value })} />}
            </div>
          ))}
          <button type="button" disabled={fieldOptions.length === 0} onClick={() => updateGroup(groupIndex, { comparisons: [...group.comparisons, { field: fieldOptions[0]?.key ?? '', op: 'equals', value: '' }] })} className="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50">+ Add comparison</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...groups, { match: 'all', comparisons: [{ field: fieldOptions[0]?.key ?? '', op: 'equals', value: '' }] }])} className="text-xs text-primary underline-offset-2 hover:underline">+ Add group</button>
    </div>
  );
}
