import type { ReactNode } from "react";
import { ShieldAlert } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import type { DirectoryGroup, GroupMutationState } from "./LifecycleGroupsWorkspace";

interface LifecycleGroupsWorkspaceDetailsProps {
  group: DirectoryGroup;
  memberCount: number;
  canManage: boolean;
  mutationState: GroupMutationState | null;
  children: ReactNode;
}

export function LifecycleGroupsWorkspaceDetails({
  group,
  memberCount,
  canManage,
  mutationState,
  children,
}: LifecycleGroupsWorkspaceDetailsProps) {
  return (
    <Card className="rounded-none border-0 border-b shadow-none">
      <CardHeader className="pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-lg">{group.name}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{group.description || group.dn}</p>
          </div>
          <Badge variant="outline">{memberCount} members</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!canManage && <Alert><ShieldAlert /><AlertTitle>Read-only membership</AlertTitle><AlertDescription>Adding or removing members requires users.manage and lifecycle.manage.</AlertDescription></Alert>}
        {mutationState?.readOnly && <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100"><ShieldAlert /><AlertTitle>Production-clone safety is on</AlertTitle><AlertDescription>{mutationState.readOnlyReason}</AlertDescription></Alert>}
        {mutationState?.protected && <Alert variant="destructive"><ShieldAlert /><AlertTitle>Protected group</AlertTitle><AlertDescription>{mutationState.protectionReason || "Administrative and privilege-bearing groups cannot be changed here."}</AlertDescription></Alert>}
        {children}
      </CardContent>
    </Card>
  );
}
