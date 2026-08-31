import { describe, expect, it } from 'vitest';

import { slugify } from './slugify.js';

describe('slugify', () => {
  it('lower-cases and hyphenates a display name', () => {
    expect(slugify('Laptop Request')).toBe('laptop-request');
  });

  it('collapses a run of non-alphanumerics to a single hyphen', () => {
    expect(slugify('IT & Support!!')).toBe('it-support');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  -Finance-  ')).toBe('finance');
  });

  it('returns an empty string for a name with no alphanumerics', () => {
    expect(slugify('!!!')).toBe('');
  });
});
