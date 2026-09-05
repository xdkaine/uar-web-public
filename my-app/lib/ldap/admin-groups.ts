type DistinguishedNameAva = {
  attribute: string;
  value: string;
};

type ParsedDistinguishedName = {
  canonical: string;
  rdns: DistinguishedNameAva[][];
};

const ATTRIBUTE_TYPE = /^(?:[a-zA-Z][a-zA-Z0-9-]*|\d+(?:\.\d+)+)$/;
const HEX_PAIR = /^[0-9a-fA-F]{2}$/;
const SIMPLE_ESCAPES = new Set([',', '+', '"', '\\', '<', '>', ';', '=', '#', ' ']);

function splitUnescaped(value: string, separator: string): string[] {
  const parts: string[] = [];
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\\') {
      if (index + 1 >= value.length) {
        throw new Error('LDAP distinguished name contains a dangling escape');
      }

      const possibleHex = value.slice(index + 1, index + 3);
      index += HEX_PAIR.test(possibleHex) ? 2 : 1;
      continue;
    }

    if (character === separator) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(value.slice(start));
  return parts;
}

function findUnescaped(value: string, characterToFind: string): number {
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '\\') {
      if (index + 1 >= value.length) {
        throw new Error('LDAP distinguished name contains a dangling escape');
      }

      const possibleHex = value.slice(index + 1, index + 3);
      index += HEX_PAIR.test(possibleHex) ? 2 : 1;
      continue;
    }

    if (character === characterToFind) {
      return index;
    }
  }

  return -1;
}

function decodeEscapedValue(rawValue: string): string {
  if (!rawValue || rawValue !== rawValue.trim()) {
    throw new Error('LDAP distinguished name values must not be empty or contain unescaped edge spaces');
  }

  if (rawValue.startsWith('#')) {
    throw new Error('Binary LDAP distinguished name values are not supported');
  }

  let decoded = '';

  for (let index = 0; index < rawValue.length;) {
    const character = rawValue[index];

    if (character !== '\\') {
      if (
        character === '"' ||
        character === '<' ||
        character === '>' ||
        character === ';' ||
        character === '='
      ) {
        throw new Error('LDAP distinguished name contains an unescaped reserved character');
      }

      decoded += character;
      index += 1;
      continue;
    }

    if (index + 1 >= rawValue.length) {
      throw new Error('LDAP distinguished name contains a dangling escape');
    }

    const possibleHex = rawValue.slice(index + 1, index + 3);
    if (HEX_PAIR.test(possibleHex)) {
      const bytes: number[] = [];
      while (
        rawValue[index] === '\\' &&
        HEX_PAIR.test(rawValue.slice(index + 1, index + 3))
      ) {
        bytes.push(Number.parseInt(rawValue.slice(index + 1, index + 3), 16));
        index += 3;
      }

      try {
        decoded += new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes));
      } catch {
        throw new Error('LDAP distinguished name contains invalid UTF-8 escapes');
      }
      continue;
    }

    const escapedCharacter = rawValue[index + 1];
    if (!SIMPLE_ESCAPES.has(escapedCharacter)) {
      throw new Error('LDAP distinguished name contains an unsupported escape');
    }

    decoded += escapedCharacter;
    index += 2;
  }

  if ([...decoded].some(character => character.charCodeAt(0) < 0x20)) {
    throw new Error('LDAP distinguished name contains a control character');
  }

  return decoded.normalize('NFC').toLowerCase();
}

function parseDistinguishedName(value: string): ParsedDistinguishedName {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('LDAP distinguished name must not be empty');
  }

  if (findUnescaped(trimmed, ';') !== -1) {
    throw new Error('LDAP distinguished names must use comma separators');
  }

  const rdns = splitUnescaped(trimmed, ',').map((rdnValue) => {
    const trimmedRdn = rdnValue.trim();
    if (!trimmedRdn) {
      throw new Error('LDAP distinguished name contains an empty RDN');
    }

    const avas = splitUnescaped(trimmedRdn, '+').map((avaValue) => {
      const equalsIndex = findUnescaped(avaValue, '=');
      if (equalsIndex <= 0) {
        throw new Error('LDAP distinguished name contains an invalid attribute-value pair');
      }

      const rawAttribute = avaValue.slice(0, equalsIndex).trim();
      const rawValue = avaValue.slice(equalsIndex + 1);
      if (!ATTRIBUTE_TYPE.test(rawAttribute)) {
        throw new Error('LDAP distinguished name contains an invalid attribute type');
      }

      return {
        attribute: rawAttribute.toLowerCase(),
        value: decodeEscapedValue(rawValue),
      };
    });

    avas.sort((left, right) => {
      const leftCanonical = `${left.attribute}=${left.value}`;
      const rightCanonical = `${right.attribute}=${right.value}`;
      return leftCanonical.localeCompare(rightCanonical);
    });

    return avas;
  });

  if (
    rdns.length < 2 ||
    !rdns[0].some(ava => ava.attribute === 'cn') ||
    !rdns.slice(1).some(rdn => rdn.some(ava => ava.attribute !== 'cn'))
  ) {
    throw new Error(
      'LDAP administrator groups must be complete DNs; use a JSON array for multiple groups'
    );
  }

  return {
    canonical: rdns
      .map(rdn => rdn.map(ava => `${ava.attribute}=${ava.value}`).join('+'))
      .join(','),
    rdns,
  };
}

/**
 * Canonical form used for every privilege-group comparison and diagnostic.
 * Keep callers on this boundary so authorization and operator tooling cannot
 * disagree about equivalent LDAP DN spellings.
 */
export function canonicalizeAdminGroupDn(value: string): string {
  return parseDistinguishedName(value).canonical;
}

export function parseAdminGroupDns(configuration: string): string[] {
  const trimmed = configuration.trim();
  if (!trimmed) {
    throw new Error('LDAP_ADMIN_GROUPS must not be empty');
  }

  let configuredGroups: unknown;
  if (trimmed.startsWith('[')) {
    try {
      configuredGroups = JSON.parse(trimmed);
    } catch {
      throw new Error('LDAP_ADMIN_GROUPS must be a valid JSON array of complete group DNs');
    }
  } else {
    configuredGroups = [trimmed];
  }

  if (
    !Array.isArray(configuredGroups) ||
    configuredGroups.length === 0 ||
    configuredGroups.some(group => typeof group !== 'string' || !group.trim())
  ) {
    throw new Error('LDAP_ADMIN_GROUPS must be a non-empty JSON array of complete group DNs');
  }

  return configuredGroups.map(canonicalizeAdminGroupDn);
}

export function isMemberOfAdminGroup(
  memberOf: string[],
  configuration: string
): boolean {
  const configuredGroups = new Set(parseAdminGroupDns(configuration));

  return memberOf.some((group) => {
    if (typeof group !== 'string' || !group.trim()) {
      return false;
    }

    try {
      return configuredGroups.has(canonicalizeAdminGroupDn(group));
    } catch {
      return false;
    }
  });
}
