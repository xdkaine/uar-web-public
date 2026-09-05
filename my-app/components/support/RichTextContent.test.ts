import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import RichTextContent from './RichTextContent';

describe('RichTextContent', () => {
  it('sanitizes legacy HTML again at the render boundary', () => {
    const rendered = renderToStaticMarkup(React.createElement(RichTextContent, {
      content: '<p>Historical<img src=x onerror="alert(1)"><a href="javascript:alert(2)">link</a></p>',
    }));

    expect(rendered).toContain('<p>Historical<a');
    expect(rendered).toContain('>link</a></p>');
    expect(rendered).not.toContain('onerror');
    expect(rendered).not.toContain('<img');
    expect(rendered).not.toContain('javascript:');
  });

  it('continues to escape legacy plain text instead of treating it as markup', () => {
    const rendered = renderToStaticMarkup(React.createElement(RichTextContent, {
      content: 'Plain <img src=x onerror="alert(1)"> text',
    }));

    expect(rendered).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(rendered).not.toContain('<img');
  });
});
