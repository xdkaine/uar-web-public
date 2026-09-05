import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

/**
 * Branding document contract (ADR-0012 follow-up): the login interaction
 * pages are rendered from a versioned, validated JSON document instead of
 * hardcoded HTML. Documents are authored in the portal admin editor, stored
 * per OIDC client_id (with a reserved "default" profile), and re-validated
 * here on every read so a tampered or stale row can never reach the page.
 *
 * PARITY: my-app/lib/auth-branding/schema.ts mirrors these types and rules.
 * Keep the two files in sync; the parity test suites pin identical fixtures.
 */

export const BRANDING_DOC_VERSION = 1;
export const DEFAULT_BRANDING_CLIENT_ID = 'default';
export const MAX_BRANDING_BLOCKS = 20;

/** OIDC client_ids we accept profile keys for. */
export const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
export const BRANDING_RADIUS_VALUES = ['none', 'sm', 'md', 'lg'] as const;
export const BRANDING_TEMPLATES = ['split', 'focused', 'compact'] as const;
const MIN_TEXT_CONTRAST = 4.5;

export interface BrandingTheme {
  pageBackground?: string;
  cardBackground?: string;
  borderColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  accentColor?: string;
  accentText?: string;
  radius?: (typeof BRANDING_RADIUS_VALUES)[number];
}

export type BrandingBlock =
  | { id: string; type: 'logo'; url: string; alt: string; heightPx: number }
  | { id: string; type: 'heading'; text: string }
  | { id: string; type: 'markdown'; markdown: string }
  | { id: string; type: 'loginForm' }
  | { id: string; type: 'divider' }
  | { id: string; type: 'footer'; text: string };

export interface BrandingDoc {
  version: typeof BRANDING_DOC_VERSION;
  /** Rendered into <title> after the page name. Defaults to "UAR Authentication". */
  titleSuffix?: string;
  theme?: BrandingTheme;
  template?: (typeof BRANDING_TEMPLATES)[number];
  stateCopy?: Partial<Record<'login' | 'change-password' | 'error', { heading?: string; body?: string }>>;
  blocks: BrandingBlock[];
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: string[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalColor(value: unknown, key: string, issues: string[]): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !COLOR_PATTERN.test(value)) {
    issues.push(`${key} must be a hex color like #1a2b3c`);
    return undefined;
  }
  return value.toLowerCase();
}

function expandHex(value: string): string {
  return value.length === 4
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value;
}

function relativeLuminance(hex: string): number {
  const normalized = expandHex(hex).slice(1);
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** WCAG 2 contrast ratio for validator and editor parity. Inputs are trusted hex tokens. */
export function colorContrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function highestContrastForeground(background: string): '#000000' | '#ffffff' {
  return colorContrastRatio('#000000', background) >= colorContrastRatio('#ffffff', background)
    ? '#000000'
    : '#ffffff';
}

const THEME_DEFAULTS = {
  light: {
    cardBackground: '#ffffff',
    textColor: '#09090b',
    mutedTextColor: '#71717a',
    accentColor: '#18181b',
    accentText: '#fafafa',
  },
  dark: {
    cardBackground: '#09090b',
    textColor: '#fafafa',
    mutedTextColor: '#a1a1aa',
    accentColor: '#fafafa',
    accentText: '#09090b',
  },
} as const;

/**
 * A custom theme is emitted in both color schemes. Check both resolved
 * surfaces so a profile cannot be readable only in the author's OS theme.
 */
export function brandingContrastIssues(theme: BrandingTheme): string[] {
  const issues: string[] = [];
  (['light', 'dark'] as const).forEach((mode) => {
    const defaults = THEME_DEFAULTS[mode];
    const card = theme.cardBackground ?? defaults.cardBackground;
    const pairs: Array<[string, string, string]> = [
      ['theme.textColor', theme.textColor ?? defaults.textColor, card],
      ['theme.mutedTextColor', theme.mutedTextColor ?? defaults.mutedTextColor, card],
      ['theme.accentText', theme.accentText ?? defaults.accentText, theme.accentColor ?? defaults.accentColor],
    ];
    pairs.forEach(([label, foreground, background]) => {
      const ratio = colorContrastRatio(foreground, background);
      if (ratio < MIN_TEXT_CONTRAST) {
        issues.push(`${label} must have at least ${MIN_TEXT_CONTRAST}:1 contrast against its ${label === 'theme.accentText' ? 'accentColor' : 'cardBackground'} in ${mode} mode (currently ${ratio.toFixed(2)}:1)`);
      }
    });
  });
  return issues;
}

function boundedString(value: unknown, key: string, min: number, max: number, issues: string[]): string | undefined {
  if (typeof value !== 'string') {
    if (value === undefined || value === null) {
      issues.push(`${key} is required`);
    } else {
      issues.push(`${key} must be a string`);
    }
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    issues.push(`${key} must be between ${min} and ${max} characters`);
    return undefined;
  }
  return trimmed;
}

function validateLogoUrl(value: unknown, issues: string[]): string | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    issues.push('logo.url is required');
    return undefined;
  }
  const candidate = value.trim();
  if (candidate.length > 2048) {
    issues.push('logo.url must be at most 2048 characters');
    return undefined;
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    issues.push('logo.url must be an absolute https URL');
    return undefined;
  }
  // https only: the sign-in page must never pull third-party assets over
  // plaintext http (mixed content + tampering surface).
  if (parsed.protocol !== 'https:') {
    issues.push('logo.url must use https');
    return undefined;
  }
  // Whitespace/control characters would break out of attribute context even
  // after escaping-driven assumptions; reject them outright.
  if (/[\s"'<>]/.test(candidate)) {
    issues.push('logo.url contains forbidden characters');
    return undefined;
  }
  return candidate;
}

function validateBlock(raw: unknown, index: number, issues: string[]): BrandingBlock | null {
  if (!isPlainObject(raw)) {
    issues.push(`blocks[${index}] must be an object`);
    return null;
  }
  const id = raw.id;
  if (typeof id !== 'string' || !BLOCK_ID_PATTERN.test(id)) {
    issues.push(`blocks[${index}].id must match ${BLOCK_ID_PATTERN.source}`);
    return null;
  }
  const prefix = `blocks[${index}]`;
  switch (raw.type) {
    case 'logo': {
      const url = validateLogoUrl(raw.url, issues);
      const alt = boundedString(raw.alt, `${prefix}.alt`, 1, 160, issues);
      const heightPx = raw.heightPx;
      if (
        typeof heightPx !== 'number' ||
        !Number.isInteger(heightPx) ||
        heightPx < 16 ||
        heightPx > 128
      ) {
        issues.push(`${prefix}.heightPx must be an integer between 16 and 128`);
        return null;
      }
      if (url === undefined || alt === undefined) return null;
      return { id, type: 'logo', url, alt, heightPx };
    }
    case 'heading': {
      const text = boundedString(raw.text, `${prefix}.text`, 1, 120, issues);
      if (text === undefined) return null;
      return { id, type: 'heading', text };
    }
    case 'markdown': {
      const markdown = boundedString(raw.markdown, `${prefix}.markdown`, 1, 2000, issues);
      if (markdown === undefined) return null;
      return { id, type: 'markdown', markdown };
    }
    case 'loginForm':
      return { id, type: 'loginForm' };
    case 'divider':
      return { id, type: 'divider' };
    case 'footer': {
      const text = boundedString(raw.text, `${prefix}.text`, 1, 200, issues);
      if (text === undefined) return null;
      return { id, type: 'footer', text };
    }
    default:
      issues.push(`${prefix}.type is not a supported block type`);
      return null;
  }
}

/**
 * Validate an untrusted branding document. Returns a rebuilt, normalized doc
 * so no unexpected properties survive into the renderer.
 */
export function validateBrandingDoc(input: unknown): ValidationResult<BrandingDoc> {
  const issues: string[] = [];
  if (!isPlainObject(input)) {
    return { ok: false, issues: ['document must be a JSON object'] };
  }
  if (input.version !== BRANDING_DOC_VERSION) {
    return { ok: false, issues: [`version must be ${BRANDING_DOC_VERSION}`] };
  }

  let titleSuffix: string | undefined;
  if (input.titleSuffix !== undefined && input.titleSuffix !== null && input.titleSuffix !== '') {
    titleSuffix = boundedString(input.titleSuffix, 'titleSuffix', 1, 60, issues);
  }

  let template: BrandingDoc['template'];
  if (input.template !== undefined && input.template !== null && input.template !== '') {
    if (typeof input.template !== 'string' || !(BRANDING_TEMPLATES as readonly string[]).includes(input.template)) {
      issues.push('template must be one of split|focused|compact');
    } else {
      template = input.template as BrandingDoc['template'];
    }
  }

  let stateCopy: BrandingDoc['stateCopy'];
  if (input.stateCopy !== undefined && input.stateCopy !== null) {
    if (!isPlainObject(input.stateCopy)) {
      issues.push('stateCopy must be an object');
    } else {
      stateCopy = {};
      for (const state of ['login', 'change-password', 'error'] as const) {
        const raw = input.stateCopy[state];
        if (raw === undefined || raw === null) continue;
        if (!isPlainObject(raw)) {
          issues.push(`stateCopy.${state} must be an object`);
          continue;
        }
        const heading = raw.heading === undefined ? undefined : boundedString(raw.heading, `stateCopy.${state}.heading`, 1, 120, issues);
        const body = raw.body === undefined ? undefined : boundedString(raw.body, `stateCopy.${state}.body`, 1, 300, issues);
        stateCopy[state] = { heading, body };
      }
    }
  }

  let theme: BrandingTheme | undefined;
  if (input.theme !== undefined && input.theme !== null) {
    if (!isPlainObject(input.theme)) {
      issues.push('theme must be an object');
    } else {
      const rawTheme = input.theme;
      const nextTheme: BrandingTheme = {};
      const colorKeys: Array<[Exclude<keyof BrandingTheme, 'radius'>, string]> = [
        ['pageBackground', 'theme.pageBackground'],
        ['cardBackground', 'theme.cardBackground'],
        ['borderColor', 'theme.borderColor'],
        ['textColor', 'theme.textColor'],
        ['mutedTextColor', 'theme.mutedTextColor'],
        ['accentColor', 'theme.accentColor'],
        ['accentText', 'theme.accentText'],
      ];
      for (const [key, label] of colorKeys) {
        const value = optionalColor(rawTheme[key], label, issues);
        if (value !== undefined) nextTheme[key] = value;
      }
      // Version 1 allowed partial color overrides. Preserve those stored
      // documents when adding contrast enforcement by filling only the missing
      // side of an explicit color pair with a deterministic readable value.
      if (nextTheme.accentColor && !nextTheme.accentText) {
        nextTheme.accentText = highestContrastForeground(nextTheme.accentColor);
      }
      if (nextTheme.cardBackground) {
        const readableText = highestContrastForeground(nextTheme.cardBackground);
        if (!nextTheme.textColor) nextTheme.textColor = readableText;
        if (!nextTheme.mutedTextColor) nextTheme.mutedTextColor = readableText;
      }
      if (rawTheme.radius !== undefined && rawTheme.radius !== null && rawTheme.radius !== '') {
        if (
          typeof rawTheme.radius !== 'string' ||
          !(BRANDING_RADIUS_VALUES as readonly string[]).includes(rawTheme.radius)
        ) {
          issues.push('theme.radius must be one of none|sm|md|lg');
        } else {
          nextTheme.radius = rawTheme.radius as BrandingTheme['radius'];
        }
      }
      issues.push(...brandingContrastIssues(nextTheme));
      theme = nextTheme;
    }
  }

  if (!Array.isArray(input.blocks) || input.blocks.length === 0) {
    issues.push('blocks must be a non-empty array');
    return issues.length ? { ok: false, issues } : { ok: false, issues: ['blocks must be a non-empty array'] };
  }
  if (input.blocks.length > MAX_BRANDING_BLOCKS) {
    issues.push(`blocks must contain at most ${MAX_BRANDING_BLOCKS} entries`);
  }

  const blocks: BrandingBlock[] = [];
  const seenIds = new Set<string>();
  let loginFormCount = 0;
  for (let index = 0; index < Math.min(input.blocks.length, MAX_BRANDING_BLOCKS); index += 1) {
    const block = validateBlock(input.blocks[index], index, issues);
    if (!block) continue;
    if (seenIds.has(block.id)) {
      issues.push(`blocks[${index}].id is duplicated`);
      continue;
    }
    seenIds.add(block.id);
    if (block.type === 'loginForm') loginFormCount += 1;
    blocks.push(block);
  }
  if (loginFormCount !== 1) {
    issues.push('blocks must contain exactly one loginForm block');
  }

  if (issues.length) return { ok: false, issues };
  return { ok: true, value: { version: BRANDING_DOC_VERSION, titleSuffix, theme, template, stateCopy, blocks } };
}

/**
 * The built-in document keeps the form as the single visual and verbal focus.
 * Application context and the fixed credential instruction come from the
 * renderer, so this profile adds only an operational audit note.
 */
export function defaultBrandingDoc(): BrandingDoc {
  return {
    version: 1,
    titleSuffix: 'UAR Authentication',
    template: 'split',
    theme: {},
    blocks: [{ id: 'default-loginform-1', type: 'loginForm' }],
  };
}

const MARKDOWN_SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'a', 'ul', 'ol', 'li', 'h3', 'h4', 'code'],
  allowedAttributes: {
    a: ['href', 'rel', 'target'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', {
      rel: 'noopener noreferrer nofollow',
      target: '_blank',
    }),
  },
};

/**
 * Markdown -> sanitized HTML fragment shared by the portal preview and this
 * service's renderer. Images/scripts/iframes are stripped by the whitelist;
 * links get noopener/noreferrer/nofollow. Both packages keep this function
 * byte-equivalent AND pin identical dependency majors (marked ^12,
 * sanitize-html ^2.17) so previews match production output exactly — bump
 * both sides together or the parity fixtures will drift apart.
 */
export function markdownToSafeHtml(markdown: string): string {
  const raw = marked.parse(markdown, { async: false }) as string;
  return sanitizeHtml(raw, MARKDOWN_SANITIZE_OPTIONS).trim();
}
