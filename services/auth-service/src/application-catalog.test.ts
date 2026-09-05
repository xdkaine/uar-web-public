import { describe, expect, it } from 'vitest';
import { validateCatalogEntry } from './application-catalog';

describe('application catalog validation', () => {
  it('normalizes a curated public OIDC application', () => {
    expect(validateCatalogEntry({
      slug: ' UAR-Portal ',
      name: 'UAR Portal',
      description: 'Access reviews',
      launchUrl: 'https://portal.example.test',
      kind: 'oidc',
      oidcClientId: 'uar-portal',
      visibility: 'public',
      sortOrder: '10',
    })).toMatchObject({
      slug: 'uar-portal',
      launchUrl: 'https://portal.example.test/',
      oidcClientId: 'uar-portal',
      visibility: 'public',
      sortOrder: 10,
    });
  });

  it.each([
    ['http launch', { slug: 'bad-app', name: 'Bad', launchUrl: 'http://bad.test', kind: 'external', visibility: 'hidden' }],
    ['embedded credentials', { slug: 'bad-app', name: 'Bad', launchUrl: 'https://u:p@bad.test', kind: 'external', visibility: 'hidden' }],
    ['missing OIDC link', { slug: 'bad-app', name: 'Bad', launchUrl: 'https://bad.test', kind: 'oidc', visibility: 'hidden' }],
  ])('rejects %s', (_label, value) => {
    expect(() => validateCatalogEntry(value)).toThrow();
  });
});
