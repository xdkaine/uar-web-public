/**
 * Friendly presentation for directory groups used in pickers and badges.
 * The raw DN is always the stored/submitted value; these helpers only decide
 * what humans see. A group whose stored `name` is missing, DN-shaped, or
 * identical to the DN falls back to its CN (container name), with the parent
 * OU path shown as secondary context.
 */
import { dnBreadcrumbSegments, splitDnRdns } from '@/lib/ldap/dn-format';

const DN_SHAPE_PATTERN = /^(CN|OU|DC)=/i;

export function cnFromDn(dn: string): string | null {
  const rdns = splitDnRdns(dn);
  if (rdns.length === 0) return null;
  const first = rdns[0];
  const index = first.indexOf('=');
  if (index <= 0) return null;
  if (first.slice(0, index).trim().toUpperCase() !== 'CN') return null;
  const value = first
    .slice(index + 1)
    .trim()
    .replace(/\\,/g, ',')
    .replace(/\\=/g, '=');
  return value || null;
}

function isFriendlyName(name: string | null | undefined, dn: string): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  if (!trimmed) return false;
  if (trimmed.toLowerCase() === dn.trim().toLowerCase()) return false;
  if (DN_SHAPE_PATTERN.test(trimmed) && trimmed.includes(',')) return false;
  return true;
}

export interface GroupDisplayInfo {
  dn: string;
  /** CN value from the DN, e.g. "CPTC". Null when the DN has no CN RDN. */
  containerName: string | null;
  /** Name shown to humans: stored friendly name, else the CN, else the DN. */
  displayName: string;
  /** Root-first parent path excluding the leaf, e.g. ["KaminoGroups", "sdc.cpp"]. */
  path: string[];
}

export function describeGroup(group: { dn: string; name?: string | null }): GroupDisplayInfo {
  const { dn } = group;
  const containerName = cnFromDn(dn);
  const displayName = isFriendlyName(group.name, dn)
    ? (group.name as string).trim()
    : containerName ?? dn;
  const segments = dnBreadcrumbSegments(dn);
  const path = segments.slice(0, Math.max(0, segments.length - 1));
  return { dn, containerName, displayName, path };
}

/** "KaminoGroups › sdc.cpp" style join for breadcrumb lines. */
export function formatGroupPath(path: string[]): string {
  return path.join(' \u203a ');
}
