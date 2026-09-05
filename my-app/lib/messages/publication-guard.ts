import type { MessageTemplateDefinition } from './catalog';

const PLACEHOLDER = /\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g;
const DESTINATION_ATTRIBUTE = /\b(?:href|src)\s*=\s*(["'])(.*?)\1/gi;
const CSS_URL = /url\(\s*(["']?)(.*?)\1\s*\)/gi;

function isReservedHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '');
  return normalized === 'localhost'
    || normalized.endsWith('.localhost')
    || normalized.endsWith('.invalid')
    || normalized.endsWith('.test')
    || normalized === 'example.com'
    || normalized.endsWith('.example.com')
    || normalized === 'example.net'
    || normalized.endsWith('.example.net')
    || normalized === 'example'
    || normalized.endsWith('.example')
    || normalized === 'example.org'
    || normalized.endsWith('.example.org')
    || normalized === 'example.edu'
    || normalized.endsWith('.example.edu')
    || normalized === 'sample'
    || normalized.endsWith('.sample');
}

function knownPlaceholders(definition: MessageTemplateDefinition): Set<string> {
  return new Set(definition.variables.map((variable) => variable.name));
}

function validatePlaceholders(source: string, allowed: Set<string>, label: string): string[] {
  const errors: string[] = [];
  for (const match of source.matchAll(PLACEHOLDER)) {
    if (!allowed.has(match[1]!)) errors.push(`${label} uses unknown placeholder {{${match[1]}}}`);
  }
  return errors;
}

function validateUrl(value: string, allowed: Set<string>, label: string): string[] {
  const errors = validatePlaceholders(value, allowed, label);
  const onlyPlaceholder = /^\s*\{\{([A-Za-z][A-Za-z0-9_]*)\}\}\s*$/.exec(value);
  if (onlyPlaceholder) {
    const name = onlyPlaceholder[1]!;
    if (allowed.has(name) && /url$/i.test(name)) return errors;
    if (allowed.has(name)) errors.push(`${label} must use a declared URL placeholder`);
    return errors;
  }
  if (/replace[_ -]?with[_ -]?approved[_ -]?url/i.test(value)) {
    errors.push(`${label} still contains the replace-required Button preset URL`);
    return errors;
  }
  try {
    const destination = new URL(value);
    if (!['https:', 'mailto:'].includes(destination.protocol)) {
      errors.push(`${label} must use an https, mailto, or declared URL placeholder destination`);
    } else if (destination.protocol === 'mailto:') {
      const recipients = decodeURIComponent(destination.pathname)
        .split(/[,;]/)
        .map((entry) => entry.trim())
        .filter(Boolean);
      for (const recipient of recipients) {
        const at = recipient.lastIndexOf('@');
        const host = at >= 0 ? recipient.slice(at + 1) : '';
        if (!host) errors.push(`${label} has an invalid mailto recipient`);
        else if (isReservedHost(host)) errors.push(`${label} uses the sample/reserved destination "${host}"`);
      }
    } else if (isReservedHost(destination.hostname)) {
      errors.push(`${label} uses the sample/reserved destination "${destination.hostname}"`);
    }
  } catch {
    errors.push(`${label} has an invalid destination URL`);
  }
  return errors;
}

function destinationValues(source: string): string[] {
  const values: string[] = [];
  for (const match of source.matchAll(DESTINATION_ATTRIBUTE)) values.push(match[2]!);
  for (const match of source.matchAll(CSS_URL)) values.push(match[2]!);
  return values;
}

/** Publication gate only: saving, previewing, and sending a [TEST] message
 * remain available to make incomplete drafts reviewable. */
export function validateMessagePublication(input: {
  definition: MessageTemplateDefinition;
  subject: string;
  body: string;
  css?: string | null;
}): string[] {
  const allowed = knownPlaceholders(input.definition);
  const errors = [
    ...validatePlaceholders(input.subject, allowed, 'Subject'),
    ...validatePlaceholders(input.body, allowed, 'Message body'),
    ...validatePlaceholders(input.css ?? '', allowed, 'Message CSS'),
  ];
  for (const value of destinationValues(input.body)) errors.push(...validateUrl(value, allowed, 'Message destination'));
  for (const value of destinationValues(input.css ?? '')) errors.push(...validateUrl(value, allowed, 'Message CSS destination'));
  return Array.from(new Set(errors));
}
