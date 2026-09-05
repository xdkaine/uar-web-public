/**
 * Presentation helpers for LDAP distinguished names. Pure string functions so
 * both server routes and client components can use them; they never contact
 * the directory and never alter the stored value - the raw DN stays the
 * source of truth, these only render it readably.
 */

const RDN_SEPARATOR = ',';

/** Split a DN into RDN components, honoring escaped commas (\,). */
export function splitDnRdns(dn: string): string[] {
  const trimmed = dn.trim();
  if (!trimmed) return [];
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i];
    if (char === '\\' && i + 1 < trimmed.length) {
      current += char + trimmed[i + 1];
      i += 1;
      continue;
    }
    if (char === RDN_SEPARATOR) {
      if (current.trim()) parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function rdnValue(rdn: string): string | null {
  const index = rdn.indexOf('=');
  if (index <= 0) return null;
  const value = rdn.slice(index + 1).trim();
  return value || null;
}

function rdnAttribute(rdn: string): string | null {
  const index = rdn.indexOf('=');
  if (index <= 0) return null;
  return rdn.slice(0, index).trim().toUpperCase();
}

/**
 * Human-readable one-line label, ordered root-first (like ADUC paths):
 * `CN=uar-bind,OU=Service Accounts,DC=sdc,DC=cpp` -> "sdc.cpp › Service Accounts › uar-bind".
 * Trailing DC components collapse into the domain name. Unparseable input is
 * returned unchanged.
 */
export function prettyDnLabel(dn: string): string {
  const rdns = splitDnRdns(dn);
  if (rdns.length === 0) return dn;

  // Trailing DC components form the domain root.
  let end = rdns.length;
  const domainParts: string[] = [];
  while (end > 0) {
    const rdn = rdns[end - 1];
    if (rdnAttribute(rdn) !== 'DC') break;
    const value = rdnValue(rdn);
    if (!value) break;
    domainParts.unshift(value);
    end -= 1;
  }

  const labels: string[] = [];
  if (domainParts.length > 0) labels.push(domainParts.join('.'));
  // Remaining RDNs are ordered leaf-first in the string; walk backward so
  // parents precede children (root-first display).
  for (let i = end - 1; i >= 0; i -= 1) {
    const value = rdnValue(rdns[i]);
    if (!value) continue;
    labels.push(value.replace(/\\,/g, ',').replace(/\\=/g, '='));
  }

  return labels.length > 0 ? labels.join(' \u203a ') : dn;
}

/** Root-first segment list for breadcrumb rendering. */
export function dnBreadcrumbSegments(dn: string): string[] {
  const label = prettyDnLabel(dn);
  if (!label.includes('\u203a')) return label.trim() ? [label] : [];
  return label.split(' \u203a ').map((segment) => segment.trim());
}
