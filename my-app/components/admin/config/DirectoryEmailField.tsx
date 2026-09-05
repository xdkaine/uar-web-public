import type { ReactNode } from "react";
import type { ConfigEntry } from "./config-types";
import { FieldShell } from "./DirectoryEmailFieldShell";
import DirectoryEmailFieldInput from "./DirectoryEmailFieldInput";
import { directoryEmailFieldDirty } from "./DirectoryEmailField.shared";

type DirectoryEmailFieldProps = {
  entry: ConfigEntry | undefined;
  drafts: Record<string, string>;
  adminGroupDns: string[];
  label: string;
  icon?: ReactNode;
  help?: ReactNode;
  onDraftChange: (key: string, value: string) => void;
  onAdminGroupDnsChange: (value: string[]) => void;
};

export default function DirectoryEmailField({
  entry,
  drafts,
  adminGroupDns,
  label,
  icon,
  help,
  onDraftChange,
  onAdminGroupDnsChange,
}: DirectoryEmailFieldProps) {
  if (!entry) return null;

  const dirty = directoryEmailFieldDirty(entry, drafts, adminGroupDns);

  return (
    <FieldShell
      id={`cfg-${entry.key}`}
      label={label}
      icon={icon}
      entry={entry}
      dirty={dirty}
      help={help}
    >
      <DirectoryEmailFieldInput
        entry={entry}
        drafts={drafts}
        adminGroupDns={adminGroupDns}
        onDraftChange={onDraftChange}
        onAdminGroupDnsChange={onAdminGroupDnsChange}
      />
    </FieldShell>
  );
}
