import { Loader2, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import type { DirectoryGroup } from "./LifecycleGroupsWorkspace";

interface LifecycleGroupsWorkspaceSidebarProps {
  groups: DirectoryGroup[];
  loading: boolean;
  query: string;
  selectedGroup: DirectoryGroup | null;
  disabled: boolean;
  onQueryChange: (query: string) => void;
  onSelectGroup: (group: DirectoryGroup) => void;
}

export function LifecycleGroupsWorkspaceSidebar({
  groups,
  loading,
  query,
  selectedGroup,
  disabled,
  onQueryChange,
  onSelectGroup,
}: LifecycleGroupsWorkspaceSidebarProps) {
  return (
    <aside className="border-b bg-muted/15 lg:border-b-0 lg:border-r">
      <div className="border-b p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Directory groups
        </p>
        <div className="relative mt-3">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search groups"
          />
        </div>
      </div>
      <div className="max-h-[28rem] space-y-1 overflow-y-auto p-2 lg:max-h-[42rem]">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading groups…
          </div>
        ) : (
          groups.map((group) => (
            <button
              key={group.dn}
              type="button"
              disabled={disabled}
              onClick={() => onSelectGroup(group)}
              className={cn(
                "w-full rounded-md border border-transparent px-3 py-2.5 text-left transition-colors hover:bg-card disabled:opacity-50",
                selectedGroup?.dn === group.dn &&
                  "border-border bg-card shadow-sm",
              )}
            >
              <span className="block truncate text-sm font-medium">
                {group.name}
              </span>
              {group.description && (
                <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                  {group.description}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
