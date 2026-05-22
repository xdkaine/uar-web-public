import { describe, expect, it } from 'vitest';
import { renderMassEmailContent, sanitizeMassEmailHtml } from './mass-email-content';

describe('mass email content rendering', () => {
  it('strips unsafe HTML while preserving email-safe content', () => {
    const html = sanitizeMassEmailHtml(`
      <h1 onclick="alert(1)">Notice</h1>
      <script>alert('x')</script>
      <a href="javascript:alert(1)">bad link</a>
      <a href="https://example.test/status">status</a>
    `);

    expect(html).toContain('<h1>Notice</h1>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('https://example.test/status');
  });

  it('appends the portal footer to HTML and text output', () => {
    const content = renderMassEmailContent('<p>Maintenance tonight.</p>');

    expect(content.html).toContain('Maintenance tonight.');
    expect(content.html).toContain('You are receiving this email because your account was included in an administrator-selected UAR Portal recipient audience.');
    expect(content.html).toContain('data-mass-email-footer="true"');
    expect(content.text).toContain('Maintenance tonight.');
    expect(content.text).toContain('administrator-selected UAR');
    expect(content.text).toContain('Portal recipient audience');
    expect(content.text).toContain('UAR Portal');
  });

  it('does not duplicate the portal footer when rendered campaign HTML is saved again', () => {
    const firstRender = renderMassEmailContent('<p>Maintenance tonight.</p>');
    const secondRender = renderMassEmailContent(firstRender.html);

    expect(secondRender.html.match(/data-mass-email-footer="true"/g)).toHaveLength(1);
    expect(secondRender.text.match(/administrator-selected UAR/g)).toHaveLength(1);
  });
});