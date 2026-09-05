import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Badge } from './badge';
import { buttonVariants } from './buttonVariants';

describe('shared primitive variant boundaries', () => {
  it.each([
    ['default', 'bg-primary'],
    ['destructive', 'bg-destructive'],
    ['outline', 'bg-background'],
    ['secondary', 'bg-secondary'],
    ['ghost', 'hover:bg-accent'],
    ['link', 'underline-offset-4'],
  ] as const)('preserves the %s button variant and native disabled control', (variant, className) => {
    const markup = renderToStaticMarkup(createElement(Button, { variant, disabled: true, type: 'button', 'aria-label': 'Fixture action' }, 'Action'));
    expect(markup).toContain('<button');
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('type="button"');
    expect(markup).toContain('aria-label="Fixture action"');
    expect(markup).toContain(className);
    expect(buttonVariants({ variant })).toContain(className);
  });

  it('preserves asChild link composition without adding a nested button', () => {
    const markup = renderToStaticMarkup(createElement(Button, { asChild: true, variant: 'outline' }, createElement('a', { href: '/fixture' }, 'Open')));
    expect(markup).toContain('<a');
    expect(markup).toContain('href="/fixture"');
    expect(markup).not.toContain('<button');
  });

  it.each([
    ['default', 'bg-primary'], ['secondary', 'bg-secondary'],
    ['destructive', 'bg-destructive'], ['outline', 'text-foreground'],
  ] as const)('preserves the %s status badge', (variant, className) => {
    const markup = renderToStaticMarkup(createElement(Badge, { variant }, 'Fixture status'));
    expect(markup).toContain('<span');
    expect(markup).toContain('data-slot="badge"');
    expect(markup).toContain(className);
    expect(markup).toContain('Fixture status');
  });
});
