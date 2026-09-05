/** memberOf DNs match a configured group by full DN, DN-suffix, or CN.
 *  Shared by the admin console login (AUTH_ADMIN_GROUPS path). */
export function groupsMatch(memberOf: string[], allowedGroups: string[]): boolean {
  if (allowedGroups.length === 0) return false;
  const lowerMemberOf = memberOf.map((dn) => dn.toLowerCase());
  return allowedGroups.some((allowed) => {
    const lower = allowed.toLowerCase();
    return lowerMemberOf.some(
      (dn) =>
        dn === lower ||
        dn.startsWith(`${lower},`) ||
        dn.endsWith(`,${lower}`) ||
        dn.includes(`,${lower},`) ||
        (!lower.startsWith('cn=') && dn.includes(`cn=${lower},`))
    );
  });
}
