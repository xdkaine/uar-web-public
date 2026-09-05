import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const appRoot = resolve(import.meta.dirname, '..');

describe('form control focus styling', () => {
  it('does not override component input rings with the global interactive halo', () => {
    const css = readFileSync(resolve(appRoot, 'app/globals.css'), 'utf8');
    const globalFocusSelector = css.slice(css.indexOf('a:focus-visible,'), css.indexOf('{', css.indexOf('a:focus-visible,')));

    expect(globalFocusSelector).not.toMatch(/\b(input|select|textarea):focus-visible\b/);
    expect(globalFocusSelector).toContain('[tabindex]:not(input):not(select):not(textarea):focus-visible');
  });

  it('gives the command input one wrapper-level focus treatment', () => {
    const command = readFileSync(resolve(appRoot, 'components/ui/command.tsx'), 'utf8');

    expect(command).toContain('focus-within:ring-[3px]');
    expect(command).toContain('focus-within:ring-ring/50');
  });
});
