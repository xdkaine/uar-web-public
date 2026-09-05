import type { ConfigEntry } from "./config-types";
import { formatValue } from "./directory-panel-shared";

export function directoryEmailFieldDirty(
  entry: ConfigEntry,
  drafts: Record<string, string>,
  adminGroupDns: string[],
) {
  if (entry.key !== "ldap.adminGroups") {
    const draft = drafts[entry.key] ?? "";
    return draft !== formatValue(entry) || (
      !entry.secret && entry.source === "environment" && draft.trim().length > 0
    );
  }
  const saved = Array.isArray(entry.value)
    ? entry.value.map(String)
    : entry.value
      ? [String(entry.value)]
      : [];
  return JSON.stringify(adminGroupDns) !== JSON.stringify(saved)
    || (entry.source === "environment" && adminGroupDns.length > 0);
}
