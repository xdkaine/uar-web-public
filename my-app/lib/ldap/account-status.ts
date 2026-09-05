interface LdapAttribute {
  type: string;
  values: string[];
}

/** AD ACCOUNTDISABLE is bit 0x2. Missing or malformed UAC fails closed. */
export function ldapAccountIsEnabled(attributes: LdapAttribute[]): boolean {
  const attribute = attributes.find((entry) => entry.type.toLowerCase() === 'useraccountcontrol');
  const raw = attribute?.values?.[0];
  if (!raw || !/^\d+$/.test(raw)) return false;
  const userAccountControl = Number(raw);
  return Number.isSafeInteger(userAccountControl) && (userAccountControl & 0x2) === 0;
}
