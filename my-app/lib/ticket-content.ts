import sanitizeHtml from 'sanitize-html';

/**
 * Single server-side sanitize pipeline for support-ticket rich content.
 * Everything a client composes (HTML) passes through sanitizeTicketHtml
 * before storage, and every renderer (portal, admin, emails) consumes only
 * that output, so what staff compose is exactly what users see.
 */

/** User-facing allowance measured after markup is removed. */
export const MAX_TICKET_TEXT_LENGTH = 5_000;
/** Defensive payload ceiling for the formatted HTML representation. */
export const MAX_TICKET_HTML_LENGTH = 50_000;

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li',
  'a', 'code', 'pre', 'blockquote', 'h3', 'h4', 'span',
];

const TICKET_TAG_PATTERN = new RegExp(
  `<\\s*/?\\s*(${ALLOWED_TAGS.filter((tag) => tag !== 'br').join('|')})\\b[^>]*>`,
  'i'
);

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    a: ['href', 'title', 'rel', 'target'],
  },
  allowedSchemes: ['https'],
  allowProtocolRelative: false,
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: {
        ...(attribs.href ? { href: attribs.href } : {}),
        ...(attribs.title ? { title: attribs.title } : {}),
        rel: 'noopener noreferrer nofollow',
        target: '_blank',
      },
    }),
  },
};

/** Truncate sanitized HTML without cutting tags in half or splitting entities. */
function truncateTicketHtml(html: string): string {
  if (html.length <= MAX_TICKET_HTML_LENGTH) return html;
  let slice = html.slice(0, MAX_TICKET_HTML_LENGTH);
  const openBracket = slice.lastIndexOf('<');
  if (openBracket !== -1 && !slice.includes('>', openBracket)) {
    slice = slice.slice(0, openBracket);
  }
  return slice.replace(/&[a-zA-Z0-9#]{0,9}$/, '');
}

export function sanitizeTicketHtml(input: string): string {
  const sanitized = sanitizeHtml(input ?? '', sanitizeOptions).trim();
  return truncateTicketHtml(sanitized);
}

const BLOCK_OPEN_PATTERN = /<\s*(p|div|li|h[1-6]|blockquote|pre|ul|ol)\b[^>]*>/gi;
const BLOCK_CLOSE_PATTERN = /<\s*\/\s*(p|div|li|h[1-6]|blockquote|pre)\s*>/gi;

export function htmlToPlainText(html: string): string {
  if (!html) return '';
  const withoutTags = html
    .replace(BLOCK_OPEN_PATTERN, '\n$&')
    .replace(BLOCK_CLOSE_PATTERN, '$&\n')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
  const decoded = withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
  return decoded
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function isEmptyRichText(html: string): boolean {
  if (!html || typeof html !== 'string') return true;
  return htmlToPlainText(html).length === 0;
}

export type TicketContentValidation =
  | { valid: true; sanitized: string }
  | { valid: false; error: string };

export function validateTicketRichText(input: string, label: string): TicketContentValidation {
  if (input.length > MAX_TICKET_HTML_LENGTH) {
    return { valid: false, error: `${label} contains too much formatted content` };
  }

  const sanitized = sanitizeTicketHtml(input);
  const plainText = htmlToPlainText(sanitized);
  if (!plainText) return { valid: false, error: `${label} is required` };
  if (plainText.length > MAX_TICKET_TEXT_LENGTH) {
    return { valid: false, error: `${label} must not exceed ${MAX_TICKET_TEXT_LENGTH} characters` };
  }

  return { valid: true, sanitized };
}

/**
 * Legacy detection heuristic: stored ticket bodies written before rich text
 * are plain text; anything containing an allowed tag is treated as HTML.
 */
export function isTicketHtml(maybe: string): boolean {
  if (!maybe || typeof maybe !== 'string') return false;
  return TICKET_TAG_PATTERN.test(maybe);
}
