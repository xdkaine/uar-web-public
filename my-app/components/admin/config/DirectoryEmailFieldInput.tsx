import { Input } from "@/components/ui/input";
import LdapDnListInput from "./LdapDnListInput";
import LdapPathInput from "./LdapPathInput";
import EmailListInput from "./EmailListInput";
import type { ConfigEntry } from "./config-types";
import { DN_FIELDS, FAILOVER_URLS_KEY } from "./directory-panel-shared";

type DirectoryEmailFieldInputProps = {
  entry: ConfigEntry;
  drafts: Record<string, string>;
  adminGroupDns: string[];
  onDraftChange: (key: string, value: string) => void;
  onAdminGroupDnsChange: (value: string[]) => void;
};

type FieldKind = "secret" | "adminGroups" | "dn" | "studentDirectors" | "text";

function fieldKind(entry: ConfigEntry): FieldKind {
  if (entry.secret) return "secret";
  if (entry.key === "ldap.adminGroups") return "adminGroups";
  if (entry.key in DN_FIELDS) return "dn";
  return entry.key === "email.studentDirectors" ? "studentDirectors" : "text";
}

function SecretInput({
  entry,
  drafts,
  onDraftChange,
}: DirectoryEmailFieldInputProps) {
  return (
    <Input
      id={`cfg-${entry.key}`}
      type="password"
      autoComplete="new-password"
      className="font-mono text-sm"
      value={drafts[entry.key] ?? ""}
      placeholder={
        entry.configured
          ? "(saved - leave blank to keep)"
          : `(env: ${entry.envFallback})`
      }
      onChange={(event) => onDraftChange(entry.key, event.target.value)}
    />
  );
}

function AdminGroupsInput({
  entry,
  adminGroupDns,
  onAdminGroupDnsChange,
}: DirectoryEmailFieldInputProps) {
  return (
    <LdapDnListInput
      id={`cfg-${entry.key}`}
      value={adminGroupDns}
      placeholder="CN=UAR Administrators,OU=Groups,DC=example,DC=org"
      onChange={onAdminGroupDnsChange}
    />
  );
}

function DnInput({
  entry,
  drafts,
  onDraftChange,
}: DirectoryEmailFieldInputProps) {
  return (
    <LdapPathInput
      id={`cfg-${entry.key}`}
      value={drafts[entry.key] ?? ""}
      suggestType={DN_FIELDS[entry.key]!}
      placeholder={
        entry.envFallback ? `(env: ${entry.envFallback})` : "CN=...,DC=..."
      }
      onChange={(value) => onDraftChange(entry.key, value)}
    />
  );
}

function StudentDirectorsInput({
  entry,
  drafts,
  onDraftChange,
}: DirectoryEmailFieldInputProps) {
  return (
    <EmailListInput
      id={`cfg-${entry.key}`}
      value={drafts[entry.key] ?? ""}
      onChange={(value) => onDraftChange(entry.key, value)}
      placeholder="director1@cpp.edu"
    />
  );
}

function TextInput({
  entry,
  drafts,
  onDraftChange,
}: DirectoryEmailFieldInputProps) {
  const placeholder =
    entry.key === FAILOVER_URLS_KEY
      ? "ldaps://dc2.sdc.cpp:636, ldaps://dc3.sdc.cpp:636"
      : entry.envFallback
        ? `(env: ${entry.envFallback})`
        : "";
  return (
    <Input
      id={`cfg-${entry.key}`}
      className="font-mono text-sm"
      value={drafts[entry.key] ?? ""}
      placeholder={placeholder}
      onChange={(event) => onDraftChange(entry.key, event.target.value)}
    />
  );
}

const inputByKind = {
  secret: SecretInput,
  adminGroups: AdminGroupsInput,
  dn: DnInput,
  studentDirectors: StudentDirectorsInput,
  text: TextInput,
};

export default function DirectoryEmailFieldInput(
  props: DirectoryEmailFieldInputProps,
) {
  const FieldInput = inputByKind[fieldKind(props.entry)];
  return <FieldInput {...props} />;
}
