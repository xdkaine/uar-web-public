import { Loader2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { DirectoryGroup, GroupMember } from "./LifecycleGroupsWorkspace";

interface LifecycleGroupsWorkspaceMembersTableProps {
  group: DirectoryGroup;
  members: GroupMember[];
  loading: boolean;
  mutating: boolean;
  canOpenRemoval: boolean;
  reviewRequiredTargets: Record<string, string>;
  onRemove: (username: string) => void;
}

export function LifecycleGroupsWorkspaceMembersTable({
  group,
  members,
  loading,
  mutating,
  canOpenRemoval,
  reviewRequiredTargets,
  onRemove,
}: LifecycleGroupsWorkspaceMembersTableProps) {
  return (
    <div className="overflow-x-auto">
      {loading ? <div className="flex items-center justify-center gap-2 py-14 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading members…</div> : (
        <table className="w-full min-w-[34rem] text-sm">
          <thead className="border-b bg-muted/20 text-left text-xs text-muted-foreground"><tr><th className="px-5 py-3 font-medium">Member</th><th className="px-5 py-3 font-medium">Username</th><th className="w-20 px-5 py-3 text-right font-medium">Action</th></tr></thead>
          <tbody>
            {members.map((member) => {
              const reviewRequired = Boolean(reviewRequiredTargets[`remove:${group.dn}:${member.username.toLowerCase()}`]);
              const title = reviewRequired ? "Resolve the outcome in Operations, then reload before retrying" : canOpenRemoval ? `Remove ${member.username}` : "Group membership changes are unavailable";
              return <tr key={member.dn} className="border-b last:border-0"><td className="px-5 py-3 font-medium">{member.displayName || member.username}{reviewRequired && <p className="mt-1 text-xs font-normal text-destructive">Review in Operations, then reload this page.</p>}</td><td className="px-5 py-3 font-mono text-xs text-muted-foreground">{member.username}</td><td className="px-5 py-3 text-right"><Button variant="ghost" size="sm" disabled={!canOpenRemoval || mutating || reviewRequired} onClick={() => onRemove(member.username)} aria-label={`Remove ${member.username}`} title={title}><Trash2 className="h-4 w-4 text-destructive" /></Button></td></tr>;
            })}
            {members.length === 0 && <tr><td colSpan={3} className="px-5 py-14 text-center text-muted-foreground">No members in this group.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
