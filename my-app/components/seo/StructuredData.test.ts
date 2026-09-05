import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { StructuredData } from './StructuredData';
import { getOrganizationStructuredData, getWebApplicationStructuredData } from './seoDocuments';

describe('StructuredData HTML boundary', () => {
  it.each([
    '</script><script>alert(1)</script>',
    '</ScRiPt><img src=x onerror="alert(1)">',
    '<!-- comment --> & <tag> \u2028 \u2029',
  ])('keeps nested text inside one JSON-LD script: %s', (payload) => {
    const data = { nested: { values: [payload] }, ordinary: 'A & B' };
    const html = renderToStaticMarkup(createElement(StructuredData, { data }));
    const opening = '<script type="application/ld+json">';
    expect(html.startsWith(opening)).toBe(true);
    expect(html.endsWith('</script>')).toBe(true);
    const serialized = html.slice(opening.length, -'</script>'.length);
    expect(serialized).not.toMatch(/[<>&]/);
    expect(html.match(/<script\b/gi)).toHaveLength(1);
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
    expect(JSON.parse(serialized)).toEqual(data);
  });

  it.each([getOrganizationStructuredData, getWebApplicationStructuredData])('preserves the existing search metadata', (generate) => {
    const data = generate();
    const html = renderToStaticMarkup(createElement(StructuredData, { data }));
    expect(JSON.parse(html.slice(html.indexOf('>') + 1, -'</script>'.length))).toEqual(data);
  });
});
