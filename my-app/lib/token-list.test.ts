import { describe, expect, it } from 'vitest';

import { mergeTokens, splitTokens } from './token-list';

describe('token list parsing', () => {
  it('splits comma, semicolon, whitespace, and newline separated recipients', () => {
    expect(splitTokens('alice, bob@example.edu; carol\ndave')).toEqual([
      'alice',
      'bob@example.edu',
      'carol',
      'dave',
    ]);
  });

  it('deduplicates recipients case-insensitively while preserving the first spelling', () => {
    expect(mergeTokens(['Alice'], 'alice, BOB@example.edu, bob@example.edu')).toEqual([
      'Alice',
      'BOB@example.edu',
    ]);
  });
});
