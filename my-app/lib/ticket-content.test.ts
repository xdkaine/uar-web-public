import { describe, expect, it } from 'vitest';
import {
  MAX_TICKET_HTML_LENGTH,
  MAX_TICKET_TEXT_LENGTH,
  htmlToPlainText,
  isEmptyRichText,
  isTicketHtml,
  sanitizeTicketHtml,
  validateTicketRichText,
} from './ticket-content';

describe('sanitizeTicketHtml', () => {
  it('strips script, iframe, and img elements entirely', () => {
    const html = sanitizeTicketHtml(
      '<p>Hello</p><script>alert(1)</script><iframe src="https://evil.test"></iframe><img src="https://evil.test/x.png" onerror="alert(1)">'
    );

    expect(html).toContain('<p>Hello</p>');
    expect(html).not.toContain('script');
    expect(html).not.toContain('iframe');
    expect(html).not.toContain('img');
    expect(html).not.toContain('onerror');
  });

  it('keeps only allowlisted tags and attributes', () => {
    const html = sanitizeTicketHtml(
      '<h1>Big</h1><h3>Section</h3><p style="color:red" onclick="x()">Text <u>u</u> <s>s</s> <em>e</em> <strong>b</strong> <code>c</code></p>'
    );

    expect(html).not.toContain('h1');
    expect(html).toContain('<h3>Section</h3>');
    expect(html).not.toContain('style=');
    expect(html).not.toContain('onclick');
    expect(html).toContain('<u>u</u>');
    expect(html).toContain('<s>s</s>');
    expect(html).toContain('<strong>b</strong>');
    expect(html).toContain('<code>c</code>');
  });

  it('enforces https-only hrefs and drops http, protocol-relative, and javascript links', () => {
    const html = sanitizeTicketHtml(
      [
        '<a href="https://ok.example.com/path?a=1">good</a>',
        '<a href="http://insecure.example.com/">http</a>',
        '<a href="//protocol-relative.example.com/">relative-scheme</a>',
        '<a href="javascript:alert(1)">js</a>',
        '<a href="/internal/path">path</a>',
      ].join('')
    );

    expect(html).toContain('href="https://ok.example.com/path?a=1"');
    expect(html).toContain('<a href="/internal/path" rel="noopener noreferrer nofollow" target="_blank">path</a>');
    expect(html).not.toContain('http://insecure.example.com');
    expect(html).not.toContain('//protocol-relative.example.com');
    expect(html).not.toContain('javascript:');
  });

  it('adds rel/target hardening to every surviving link', () => {
    const html = sanitizeTicketHtml('<a href="https://example.test">link</a>');

    expect(html).toBe(
      '<a href="https://example.test" rel="noopener noreferrer nofollow" target="_blank">link</a>'
    );
  });

  it('escapes stray angle brackets and preserves entities in text', () => {
    const html = sanitizeTicketHtml('<p>Fish &amp; Chips &lt;3 &gt; 2 "quotes"</p>');

    expect(html).toBe('<p>Fish &amp; Chips &lt;3 &gt; 2 "quotes"</p>');
    expect(html).not.toMatch(/<3/);
  });

  it('caps output length without dangling tags or partial entities', () => {
    const longParagraphs = Array.from({ length: 900 }, (_, i) => `<p>Paragraph ${i} with some content &amp;&amp; more</p>`).join('');
    const html = sanitizeTicketHtml(longParagraphs);

    expect(html.length).toBeLessThanOrEqual(MAX_TICKET_HTML_LENGTH);
    expect(html.endsWith('&')).toBe(false);
    expect((html.match(/</g) ?? []).length).toBe((html.match(/>/g) ?? []).length);
  });

  it('passes legacy plain text through mostly intact', () => {
    const text = sanitizeTicketHtml('Request ID: abc123\n\nIssue:\nCannot sign in');

    expect(text).toContain('Request ID: abc123\n\nIssue:\nCannot sign in');
  });
});

describe('validateTicketRichText', () => {
  it('applies the user-facing limit to visible text instead of formatting markup', () => {
    const formatted = `<p>${'<strong>x</strong>'.repeat(1_000)}</p>`;
    const result = validateTicketRichText(formatted, 'Message');

    expect(formatted.length).toBeGreaterThan(MAX_TICKET_TEXT_LENGTH);
    expect(result.valid).toBe(true);
  });

  it('rejects text beyond the visible character limit', () => {
    const result = validateTicketRichText(`<p>${'x'.repeat(MAX_TICKET_TEXT_LENGTH + 1)}</p>`, 'Message');

    expect(result).toMatchObject({
      valid: false,
      error: `Message must not exceed ${MAX_TICKET_TEXT_LENGTH} characters`,
    });
  });

  it('rejects an excessive raw HTML payload separately', () => {
    const result = validateTicketRichText('x'.repeat(MAX_TICKET_HTML_LENGTH + 1), 'Message');

    expect(result.valid).toBe(false);
    if (result.valid) throw new Error('Expected raw HTML validation to fail');
    expect(result.error).toContain('formatted content');
  });
});

describe('htmlToPlainText', () => {
  it('strips tags, decodes entities, and collapses whitespace', () => {
    const text = htmlToPlainText(
      '<h3>Summary</h3><p>Line one<br>Line two</p><ul><li>Item &amp; thing</li></ul><blockquote>&quot;Quoted&quot;</blockquote>'
    );

    expect(text).toContain('Summary');
    expect(text).toContain('Line one\nLine two');
    expect(text).toContain('Item & thing');
    expect(text).toContain('"Quoted"');
    expect(text).not.toContain('<');
    expect(text).not.toContain('&amp;');
    expect(text).not.toMatch(/  /);
  });

  it('returns empty string for empty input', () => {
    expect(htmlToPlainText('')).toBe('');
  });
});

describe('isEmptyRichText', () => {
  it('detects empty documents in every common shape', () => {
    expect(isEmptyRichText('')).toBe(true);
    expect(isEmptyRichText('<p></p>')).toBe(true);
    expect(isEmptyRichText('<p>   </p>')).toBe(true);
    expect(isEmptyRichText('<p><br></p>')).toBe(true);
    expect(isEmptyRichText('<p></p><p></p>')).toBe(true);
    expect(isEmptyRichText('&nbsp;')).toBe(true);
  });

  it('accepts real content', () => {
    expect(isEmptyRichText('<p>Issue details here</p>')).toBe(false);
    expect(isEmptyRichText('plain text issue')).toBe(false);
  });
});

describe('isTicketHtml', () => {
  it('flags rich content and passes through legacy plain text', () => {
    expect(isTicketHtml('<p>Hello</p>')).toBe(true);
    expect(isTicketHtml('Request ID: abc\n\nIssue:\nplain text body')).toBe(false);
    expect(isTicketHtml('5 < 10 but not markup')).toBe(false);
    expect(isTicketHtml('')).toBe(false);
  });
});
