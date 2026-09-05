import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountName } from './AccountName';
describe('account display name', () => {
  it('shows the person name while preserving the exact account for accessible hover/focus details', () => {
    const html = renderToStaticMarkup(createElement(AccountName, { username: 'ada123', displayName: 'Ada Lovelace' }));
    expect(html).toContain('>Ada Lovelace</button>');
    expect(html).toContain('aria-label="Ada Lovelace — account ada123"');
    expect(html).toContain('type="button"');
  });
  it('keeps the username when there is no reliable name', () => {
    expect(renderToStaticMarkup(createElement(AccountName, { username: 'service001' }))).toContain('>service001</button>');
  });
});
