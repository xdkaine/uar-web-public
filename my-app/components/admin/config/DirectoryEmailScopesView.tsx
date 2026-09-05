import type { ReactNode } from "react";
import { FolderTree, Users } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type DirectoryEmailScopesViewProps = {
  renderField: (
    key: string,
    label: string,
    icon?: ReactNode,
    help?: ReactNode,
  ) => ReactNode;
};

export default function DirectoryEmailScopesView({
  renderField: field,
}: DirectoryEmailScopesViewProps) {
  return (
    <>
      <Card
        id="directory-search-scopes"
        className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FolderTree className="h-5 w-5" /> Search scopes
          </CardTitle>
          <CardDescription>
            A search base is the starting point in the Active Directory tree —
            like choosing which folder to search inside. Users are found under
            the user base; group checks use the group base. Type a path or pick
            a suggestion — the friendly path below each field shows how it reads
            in the tree.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {field(
            "ldap.searchBase",
            "User search base",
            undefined,
            "Where the portal looks up user accounts during sign-in and account searches.",
          )}
          {field(
            "ldap.groupSearchBase",
            "Group search base",
            undefined,
            "Where the portal looks up groups — used for membership checks and the provisioning targets below.",
          )}
        </CardContent>
      </Card>
      <Card
        id="directory-provisioning-targets"
        className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" /> Group access &amp; provisioning
            targets
          </CardTitle>
          <CardDescription>
            Who can administer this portal, and which AD groups newly
            provisioned accounts join.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {field(
            "ldap.adminGroups",
            "Administrator groups",
            undefined,
            "Members of any of these groups are treated as system administrators of this portal (the legacy administrator gate).",
          )}
          {field(
            "ldap.kaminoInternalGroup",
            "Internal target group",
            undefined,
            "When provisioning an internal AD account, the new account is added to this Kamino group.",
          )}
          {field(
            "ldap.kaminoExternalGroup",
            "External target group",
            undefined,
            "When provisioning an external collaborator account, the new account is added to this Kamino group instead.",
          )}
          {field(
            "ldap.group2Add",
            "Default group-add target",
            undefined,
            "Every newly created AD account is automatically added to this group right after creation.",
          )}
        </CardContent>
      </Card>
    </>
  );
}
