import { describe, expect, it } from 'vitest';
import { renderMessageDocument, sanitizeMessageTemplateSource } from './renderer';

describe('message render pipeline', () => {
  it('substitutes, inlines email-safe CSS, and emits matching plain text', () => {
    const result = renderMessageDocument('<p class="lead">Hello {{name}}</p>', { name: 'Ada' }, '.lead { color: #2563EB; font-weight: bold; }');
    expect(result.html).toContain('Hello Ada');
    expect(result.html).toMatch(/color:\s*#2563EB/i);
    expect(result.text).toContain('Hello Ada');
    expect(result.diagnostics).toEqual([]);
  });

  it('strips active content and unsafe URLs while reporting unresolved placeholders', () => {
    const result = renderMessageDocument('<script>alert(1)</script><a href="javascript:alert(1)">{{missing}}</a>', {});
    expect(result.html).not.toContain('<script');
    expect(result.html).not.toContain('javascript:');
    expect(result.diagnostics).toContain('Unknown placeholder: {{missing}}');
  });

  it('uses the same sanitizer for persisted source', () => {
    expect(sanitizeMessageTemplateSource('<img src="https://tracker.test/pixel"><form><input></form>')).not.toContain('<form');
  });

  it('preserves the safe layout styles used by legacy email defaults', () => {
    const result = renderMessageDocument(
      '<table style="border-collapse: collapse"><tr><td style="white-space: pre-wrap; word-break: break-all">Value</td></tr></table>' +
      '<hr style="border: none; border-top: 1px solid #ddd">',
      {}
    );
    expect(result.html).toMatch(/border-collapse:\s*collapse/i);
    expect(result.html).toMatch(/white-space:\s*pre-wrap/i);
    expect(result.html).toMatch(/word-break:\s*break-all/i);
    expect(result.html).toMatch(/border-top:\s*1px solid #ddd/i);
  });
});
