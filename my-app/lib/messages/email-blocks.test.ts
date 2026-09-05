import { describe, expect, it } from 'vitest';
import { MESSAGE_TEMPLATE_CATALOG } from './catalog';
import { parseEmailBlockDocument, serializeEmailBlockDocument } from './email-blocks';

describe('email block documents', () => {
  it('round-trips every catalog body byte-for-byte', () => {
    for (const definition of Object.values(MESSAGE_TEMPLATE_CATALOG)) {
      if (definition.subjectOnly) continue;
      const source = definition.defaultBody ?? '';
      expect(serializeEmailBlockDocument(parseEmailBlockDocument(source)), definition.key).toBe(source);
    }
  });

  it.each(['request.account_ready', 'ticket.created_admin', 'offboard.extension']) (
    'exposes useful editable sections for %s',
    (key) => {
      const source = MESSAGE_TEMPLATE_CATALOG[key].defaultBody ?? '';
      const document = parseEmailBlockDocument(source);
      expect(document.blocks.length).toBeGreaterThan(2);
      expect(document.blocks.some((block) => block.kind !== 'custom-html')).toBe(true);
      expect(serializeEmailBlockDocument(document)).toBe(source);
    }
  );
});
