export type EmailBlockKind =
  | 'heading'
  | 'paragraph'
  | 'callout'
  | 'details'
  | 'button'
  | 'list'
  | 'divider'
  | 'conditional'
  | 'custom-html';

export interface EmailContentBlock {
  id: string;
  kind: EmailBlockKind;
  label: string;
  html: string;
}

export interface EmailBlockDocument {
  frameStart: string;
  blocks: EmailContentBlock[];
  frameEnd: string;
}

export const EMAIL_BLOCK_PRESETS: ReadonlyArray<{
  kind: EmailBlockKind;
  label: string;
  html: string;
}> = [
  { kind: 'heading', label: 'Heading', html: '<h2>New heading</h2>' },
  { kind: 'paragraph', label: 'Paragraph', html: '<p>New paragraph</p>' },
  {
    kind: 'callout',
    label: 'Callout',
    html: '<div style="background-color:#f0fdf4;padding:16px;border-left:4px solid #059669;border-radius:4px;margin:16px 0;"><p style="margin:0;">Callout text</p></div>',
  },
  {
    kind: 'details',
    label: 'Details table',
    html: '<table style="width:100%;border-collapse:collapse;"><tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Label</td><td style="padding:8px;border:1px solid #ddd;">Value</td></tr></table>',
  },
  { kind: 'button', label: 'Button (replace link)', html: '<p><a href="REPLACE_WITH_APPROVED_URL" style="display:inline-block;padding:12px 20px;background:#059669;color:#fff;text-decoration:none;border-radius:4px;">Replace this button link</a></p>' },
  { kind: 'list', label: 'List', html: '<ul><li>List item</li></ul>' },
  { kind: 'divider', label: 'Divider', html: '<hr style="border:0;border-top:1px solid #ddd;margin:24px 0;">' },
];

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const FRAME_ELEMENTS = new Set(['article', 'div', 'main', 'section']);

interface HtmlToken {
  start: number;
  end: number;
  type: 'open' | 'close' | 'standalone';
  name: string | null;
  selfClosing: boolean;
}

function findTagEnd(source: string, start: number) {
  let quote: '"' | "'" | null = null;
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index + 1;
    }
  }
  return source.length;
}

function readToken(source: string, start: number): HtmlToken | null {
  if (source[start] !== '<') return null;
  if (source.startsWith('<!--', start)) {
    const commentEnd = source.indexOf('-->', start + 4);
    return {
      start,
      end: commentEnd < 0 ? source.length : commentEnd + 3,
      type: 'standalone',
      name: null,
      selfClosing: true,
    };
  }

  const end = findTagEnd(source, start);
  const raw = source.slice(start, end);
  if (/^<\s*[!?]/.test(raw)) {
    return { start, end, type: 'standalone', name: null, selfClosing: true };
  }

  const closing = /^<\s*\/\s*([a-zA-Z][\w:-]*)/.exec(raw);
  if (closing) {
    return { start, end, type: 'close', name: closing[1].toLowerCase(), selfClosing: false };
  }

  const opening = /^<\s*([a-zA-Z][\w:-]*)/.exec(raw);
  if (!opening) return null;
  const name = opening[1].toLowerCase();
  const selfClosing = VOID_ELEMENTS.has(name) || /\/\s*>$/.test(raw);
  return { start, end, type: 'open', name, selfClosing };
}

function skipWhitespace(source: string, start: number, end: number) {
  let index = start;
  while (index < end && /\s/.test(source[index])) index += 1;
  return index;
}

function findFrame(source: string): { start: number; openingEnd: number; closingStart: number; end: number } | null {
  const rootStart = skipWhitespace(source, 0, source.length);
  const opening = readToken(source, rootStart);
  if (!opening || opening.type !== 'open' || opening.selfClosing || !opening.name || !FRAME_ELEMENTS.has(opening.name)) {
    return null;
  }

  let depth = 1;
  let index = opening.end;
  while (index < source.length) {
    const nextTag = source.indexOf('<', index);
    if (nextTag < 0) return null;
    const token = readToken(source, nextTag);
    if (!token) {
      index = nextTag + 1;
      continue;
    }
    if (token.name === opening.name) {
      if (token.type === 'open' && !token.selfClosing) depth += 1;
      if (token.type === 'close') depth -= 1;
    }
    if (depth === 0) {
      if (skipWhitespace(source, token.end, source.length) !== source.length) return null;
      return { start: rootStart, openingEnd: opening.end, closingStart: token.start, end: token.end };
    }
    index = token.end;
  }
  return null;
}

function splitTopLevel(source: string, start: number, end: number): string[] {
  const parts: string[] = [];
  let partStart = start;
  let depth = 0;
  let hasMarkup = false;
  let index = start;

  while (index < end) {
    const nextTag = source.indexOf('<', index);
    if (nextTag < 0 || nextTag >= end) break;
    const token = readToken(source, nextTag);
    if (!token || token.end > end) {
      index = nextTag + 1;
      continue;
    }
    hasMarkup = true;
    if (token.type === 'open' && !token.selfClosing) depth += 1;
    if (token.type === 'close') depth = Math.max(0, depth - 1);
    index = token.end;

    if (depth === 0) {
      let partEnd = index;
      while (partEnd < end && /\s/.test(source[partEnd])) partEnd += 1;
      parts.push(source.slice(partStart, partEnd));
      partStart = partEnd;
      index = partEnd;
    }
  }

  if (partStart < end) parts.push(source.slice(partStart, end));
  if (!hasMarkup && parts.length === 0 && end > start) parts.push(source.slice(start, end));
  return parts.filter((part) => part.length > 0);
}

function classifyBlock(html: string): { kind: EmailBlockKind; label: string } {
  const trimmed = html.trim();
  if (/^<h[1-6]\b/i.test(trimmed)) return { kind: 'heading', label: 'Heading' };
  if (/^<p\b/i.test(trimmed)) {
    if (/<a\b[^>]*style=["'][^"']*(?:display\s*:\s*inline-block|background(?:-color)?\s*:)/i.test(trimmed)) {
      return { kind: 'button', label: 'Action' };
    }
    return { kind: 'paragraph', label: 'Paragraph' };
  }
  if (/^<(?:ul|ol)\b/i.test(trimmed)) return { kind: 'list', label: 'List' };
  if (/^<table\b/i.test(trimmed)) return { kind: 'details', label: 'Details table' };
  if (/^<hr\b/i.test(trimmed)) return { kind: 'divider', label: 'Divider' };
  if (/^<a\b/i.test(trimmed)) return { kind: 'button', label: 'Action' };
  if (/^\{\{[\w.]+(?:Block|Rows?|Notice|Greeting)\}\}$/i.test(trimmed)) {
    return { kind: 'conditional', label: 'Conditional content' };
  }
  if (/^<div\b/i.test(trimmed) && /(?:background(?:-color)?|border-left|border-radius)\s*:/i.test(trimmed)) {
    return { kind: 'callout', label: 'Callout' };
  }
  return { kind: 'custom-html', label: 'HTML section' };
}

export function parseEmailBlockDocument(source: string): EmailBlockDocument {
  if (!source) return { frameStart: '', blocks: [], frameEnd: '' };
  const frame = findFrame(source);
  const contentStart = frame?.openingEnd ?? 0;
  const contentEnd = frame?.closingStart ?? source.length;
  const parts = splitTopLevel(source, contentStart, contentEnd);
  const blocks = parts.map((html, index) => {
    const classification = classifyBlock(html);
    return {
      id: `${classification.kind}-${index + 1}`,
      ...classification,
      html,
    };
  });

  if (blocks.length === 0 && source) {
    return {
      frameStart: '',
      blocks: [{ id: 'custom-html-1', kind: 'custom-html', label: 'HTML section', html: source }],
      frameEnd: '',
    };
  }

  return {
    frameStart: frame ? source.slice(0, frame.openingEnd) : '',
    blocks,
    frameEnd: frame ? source.slice(frame.closingStart) : '',
  };
}

export function serializeEmailBlockDocument(document: EmailBlockDocument) {
  return `${document.frameStart}${document.blocks.map((block) => block.html).join('')}${document.frameEnd}`;
}
