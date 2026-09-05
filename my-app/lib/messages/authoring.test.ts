import { describe, expect, it } from 'vitest';
import { MESSAGE_TEMPLATE_CATALOG } from './catalog';
import { renderMessageAuthoringSample } from './authoring';

describe('message authoring samples', () => {
  it('renders the main-branch rejection message with realistic values', () => {
    const definition = MESSAGE_TEMPLATE_CATALOG['request.rejection_notice'];
    const result = renderMessageAuthoringSample({
      definition,
      subject: definition.defaultSubject ?? '',
      body: definition.defaultBody ?? '',
    });

    expect(result.subject).toBe('Access Request Update - Cal Poly Pomona Student SOC');
    expect(result.html).toMatch(/font-family:\s*Arial/i);
    expect(result.html).toMatch(/max-width:\s*600px/i);
    expect(result.html).toContain('Hello Alex Rivera');
    expect(result.html).toContain('Duplicate request');
    expect(result.diagnostics).toEqual([]);
  });

  it('resolves every declared placeholder in every catalog default', () => {
    for (const definition of Object.values(MESSAGE_TEMPLATE_CATALOG)) {
      const result = renderMessageAuthoringSample({
        definition,
        subject: definition.defaultSubject ?? '',
        body: definition.defaultBody ?? '',
      });
      expect(result.diagnostics, definition.key).toEqual([]);
      expect(result.subject, definition.key).not.toMatch(/\{\{\w+\}\}/);
    }
  });
});
