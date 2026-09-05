'use client';

import { Search, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ticketCategoryLabel } from '@/lib/support/ticket-categories';
import { cn } from '@/lib/utils';

export type StatusFilter = 'all' | 'open' | 'in_progress' | 'closed';
export type SeverityFilter = 'all' | 'critical' | 'high' | 'medium' | 'low';

const STATUS_VIEWS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'closed', label: 'Closed' },
];

interface TicketsListFiltersProps {
  availableCategories: string[];
  counts: Record<StatusFilter, number>;
  filterCategory: string;
  filterSeverity: SeverityFilter;
  filterStatus: StatusFilter;
  hasActiveFilters: boolean;
  searchQuery: string;
  onCategoryChange: (value: string) => void;
  onClear: () => void;
  onSearchChange: (value: string) => void;
  onSeverityChange: (value: SeverityFilter) => void;
  onStatusChange: (value: StatusFilter) => void;
}

export default function TicketsListFilters({
  availableCategories,
  counts,
  filterCategory,
  filterSeverity,
  filterStatus,
  hasActiveFilters,
  searchQuery,
  onCategoryChange,
  onClear,
  onSearchChange,
  onSeverityChange,
  onStatusChange,
}: TicketsListFiltersProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {STATUS_VIEWS.map((view) => (
        <button
          key={view.value}
          type="button"
          aria-pressed={filterStatus === view.value}
          onClick={() => onStatusChange(view.value)}
          className={cn(
            'inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all',
            filterStatus === view.value
              ? 'border-primary bg-primary text-primary-foreground shadow-sm'
              : 'border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          {view.label}
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 text-xs',
              filterStatus === view.value
                ? 'bg-primary-foreground/20 text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            )}
          >
            {counts[view.value]}
          </span>
        </button>
      ))}

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Input
            placeholder="Search subject, ID, or category…"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
            className="pl-9"
          />
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        </div>
        <Select value={filterSeverity} onValueChange={(value) => onSeverityChange(value as SeverityFilter)}>
          <SelectTrigger className="w-[130px] bg-card">
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterCategory} onValueChange={onCategoryChange}>
          <SelectTrigger className="w-[150px] bg-card">
            <SelectValue placeholder="Category" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {availableCategories.map((category) => (
              <SelectItem key={category} value={category}>{ticketCategoryLabel(category)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClear}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="mr-1 h-4 w-4" />
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
