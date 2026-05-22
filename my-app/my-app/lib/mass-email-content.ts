import sanitizeHtml from 'sanitize-html';
import { htmlToText } from 'html-to-text';

const footerHtml = `
  <hr style="border:0;border-top:1px solid #d1d5db;margin:24px 0;" />
  <div data-mass-email-footer="true" style="color:#4b5563;font-size:12px;line-height:1.5;margin:0;">
    <p style="margin:0 0 8px 0;">
      You are receiving this email because your account was included in an administrator-selected UAR Portal recipient audience.
    </p>
    <p style="margin:0 0 8px 0;">
      You are receiving this email because of your active account within the Student Data Center @ <a href="https://www.cpp.edu" target="_blank" rel="noopener noreferrer">Cal Poly Pomona</a>.
    </p>
    <p style="margin:0;">
      This message was submitted by the <a href="https://calpolysoc.org" target="_blank" rel="noopener noreferrer">Cal Poly SOC</a> UAR Portal.
    </p>
  </div>
`;

const allowedStyles = {
  '*': {
    color: [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i, /^rgba\(/i, /^[a-z]+$/i],
    'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i, /^rgba\(/i, /^[a-z]+$/i],
    'border-color': [/^#[0-9a-f]{3,8}$/i, /^rgb\(/i, /^rgba\(/i, /^[a-z]+$/i],
    'border-style': [/^(none|solid|dashed|dotted)$/i],
    'border-width': [/^\d+(px|em|rem|%)$/i, /^0$/],
    'border-radius': [/^\d+(px|em|rem|%)$/i, /^0$/],
    'font-size': [/^\d+(px|em|rem|%)$/i],
    'font-weight': [/^(normal|bold|bolder|lighter|[1-9]00)$/i],
    'font-family': [/^[a-z0-9\s,'"-]+$/i],
    'line-height': [/^\d+(\.\d+)?(px|em|rem|%)?$/i],
    margin: [/^[\d\s.pxemrem%auto-]+$/i],
    padding: [/^[\d\s.pxemrem%-]+$/i],
    width: [/^\d+(px|em|rem|%)$/i, /^auto$/i],
    'max-width': [/^\d+(px|em|rem|%)$/i, /^none$/i],
    'text-align': [/^(left|right|center|justify)$/i],
    'text-decoration': [/^(none|underline|line-through)$/i],
    display: [/^(block|inline|inline-block|table|table-row|table-cell)$/i],
  },
};

const sanitizeOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    'a', 'b', 'blockquote', 'br', 'code', 'div', 'em', 'h1', 'h2', 'h3', 'h4', 'hr',
    'i', 'img', 'li', 'ol', 'p', 'pre', 'span', 'strong', 'table', 'tbody', 'td',
    'th', 'thead', 'tr', 'u', 'ul'
  ],
  allowedAttributes: {
    '*': ['style', 'align'],
    a: ['href', 'name', 'target', 'title', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    table: ['cellpadding', 'cellspacing', 'border', 'width'],
    td: ['colspan', 'rowspan', 'width', 'height'],
    th: ['colspan', 'rowspan', 'width', 'height'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'cid'],
  allowedStyles,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }),
  },
};

export function sanitizeMassEmailHtml(rawHtml: string): string {
  const sanitized = sanitizeHtml(rawHtml || '', sanitizeOptions).trim();
  return sanitized || '<p></p>';
}

export function stripMassEmailFooter(rawHtml: string): string {
  const html = rawHtml || '';
  const markerIndex = [
    'data-mass-email-footer="true"',
    "data-mass-email-footer='true'",
    'This message was submitted by the Cal Poly SOC UAR Portal.',
    'administrator-selected UAR Portal recipient audience.',
  ]
    .map((marker) => html.indexOf(marker))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];
  if (markerIndex === -1) return rawHtml || '';

  const contentBeforeMarker = html.slice(0, markerIndex);
  const footerStart = contentBeforeMarker.lastIndexOf('<hr');
  return (footerStart === -1 ? contentBeforeMarker : html.slice(0, footerStart)).trim();
}

export function renderMassEmailHtml(rawHtml: string): string {
  return `${sanitizeMassEmailHtml(stripMassEmailFooter(rawHtml))}\n${footerHtml}`;
}

export function generateMassEmailText(html: string): string {
  return htmlToText(html, {
    wordwrap: 100,
    selectors: [
      { selector: 'a', options: { hideLinkHrefIfSameAsText: true } },
      { selector: 'img', format: 'skip' },
    ],
  }).trim();
}

export function renderMassEmailContent(rawHtml: string): { html: string; text: string } {
  const html = renderMassEmailHtml(rawHtml);
  return { html, text: generateMassEmailText(html) };
}