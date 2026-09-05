import juice from 'juice';
import { htmlToText } from 'html-to-text';
import sanitizeHtml from 'sanitize-html';

const ALLOWED_TAGS = [
  'html', 'body', 'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
  'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'hr', 'a', 'span',
  'div', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'img',
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  allowedAttributes: {
    '*': ['style', 'class', 'align', 'role', 'aria-label'],
    a: ['href', 'title', 'target', 'rel', 'style', 'class'],
    img: ['src', 'alt', 'width', 'height', 'style', 'class'],
    table: ['width', 'cellpadding', 'cellspacing', 'role', 'style', 'class'],
    td: ['width', 'colspan', 'rowspan', 'align', 'valign', 'style', 'class'],
    th: ['width', 'colspan', 'rowspan', 'align', 'valign', 'style', 'class'],
  },
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-f]{3,8}$/i, /^rgb(a)?\(/i, /^[a-z]+$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb(a)?\(/i, /^transparent$/i],
      'font-family': [/^[\w\s,'"-]+$/],
      'font-size': [/^\d+(?:\.\d+)?(?:px|em|rem|%)$/],
      'font-weight': [/^(?:normal|bold|[1-9]00)$/],
      'font-style': [/^(?:normal|italic)$/],
      'line-height': [/^\d+(?:\.\d+)?(?:px|em|rem|%)?$/],
      'text-align': [/^(?:left|right|center|justify)$/],
      'text-decoration': [/^(?:none|underline|line-through)$/],
      margin: [/^[\d.\spxemrem%auto-]+$/],
      'margin-top': [/^[\d.\spxemrem%auto-]+$/],
      'margin-right': [/^[\d.\spxemrem%auto-]+$/],
      'margin-bottom': [/^[\d.\spxemrem%auto-]+$/],
      'margin-left': [/^[\d.\spxemrem%auto-]+$/],
      padding: [/^[\d.\spxemrem%-]+$/],
      'padding-top': [/^[\d.\spxemrem%-]+$/],
      'padding-right': [/^[\d.\spxemrem%-]+$/],
      'padding-bottom': [/^[\d.\spxemrem%-]+$/],
      'padding-left': [/^[\d.\spxemrem%-]+$/],
      border: [/^[\d.\s#a-z()-]+$/i],
      'border-left': [/^[\d.\s#a-z()-]+$/i],
      'border-top': [/^[\d.\s#a-z()-]+$/i],
      'border-collapse': [/^(?:collapse|separate)$/],
      'border-radius': [/^[\d.\spxemrem%]+$/],
      width: [/^[\d.\spxemrem%auto]+$/],
      'max-width': [/^[\d.\spxemrem%none]+$/],
      display: [/^(?:block|inline|inline-block|table|table-row|table-cell|none)$/],
      'white-space': [/^(?:normal|nowrap|pre|pre-wrap|pre-line)$/],
      'word-break': [/^(?:normal|break-all|keep-all|break-word)$/],
    },
  },
  allowedSchemes: ['https', 'mailto'],
  allowProtocolRelative: false,
  transformTags: {
    a: (_tagName, attribs) => ({ tagName: 'a', attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' } }),
  },
};

export function sanitizeMessageTemplateSource(raw: string): string {
  return sanitizeHtml(raw, SANITIZE_OPTIONS);
}

function substitute(source: string, variables: Record<string, string>): string {
  return source.replace(/\{\{(\w+)\}\}/g, (match, name: string) => variables[name] === undefined ? match : variables[name]);
}

export function renderMessageDocument(
  source: string,
  variables: Record<string, string>,
  css = ''
): { html: string; text: string; diagnostics: string[] } {
  const rendered = substitute(source, variables);
  const unknown = Array.from(new Set(Array.from(rendered.matchAll(/\{\{(\w+)\}\}/g)).map((match) => match[1]!)));
  let inlined = rendered;
  try {
    inlined = juice.inlineContent(rendered, css, { removeStyleTags: true, preserveMediaQueries: false, applyStyleTags: true });
  } catch {
    // Sanitization still produces safe preview/output and the diagnostic tells
    // the editor that the CSS could not be applied.
  }
  const html = sanitizeHtml(inlined, SANITIZE_OPTIONS);
  const diagnostics = unknown.map((name) => `Unknown placeholder: {{${name}}}`);
  if (source.trim() && !html.trim()) diagnostics.push('All message markup was removed by the email safety policy.');
  return {
    html,
    text: htmlToText(html, { wordwrap: 100, selectors: [{ selector: 'img', format: 'skip' }] }).trim(),
    diagnostics,
  };
}
