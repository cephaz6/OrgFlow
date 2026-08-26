import { describe, expect, it } from 'vitest';

import { buildNextHref, buildPrevHref, parsePaginationParams } from './pagination';

describe('parsePaginationParams', () => {
  it('reads no cursor and no history from an empty search', () => {
    expect(parsePaginationParams({})).toEqual({ cursor: undefined, history: [] });
  });

  it('reads a cursor with no history', () => {
    expect(parsePaginationParams({ cursor: 'c2' })).toEqual({ cursor: 'c2', history: [] });
  });

  it('splits a history string on commas, preserving an empty first entry', () => {
    expect(parsePaginationParams({ cursor: 'c3', history: ',c2' })).toEqual({
      cursor: 'c3',
      history: ['', 'c2'],
    });
  });
});

describe('buildNextHref', () => {
  it('from page 1 (no cursor, no history), pushes an empty marker for page 1', () => {
    const href = buildNextHref('/things', {}, 'c2');
    expect(href).toBe('/things?cursor=c2&history=');
  });

  it('from page 2, pushes the current cursor onto history', () => {
    // URLSearchParams percent-encodes the leading comma (the "page 1 had no
    // cursor" marker); that is standard, correct query-string encoding and
    // decodes back to a literal comma when read, proven by the round-trip
    // tests below, so the assertion checks the decoded param, not the raw
    // string.
    const href = buildNextHref('/things', { cursor: 'c2', history: '' }, 'c3');
    const url = new URL(`https://x${href}`);
    expect(url.searchParams.get('cursor')).toBe('c3');
    expect(url.searchParams.get('history')).toBe(',c2');
  });

  it('preserves an unrelated search param such as a query filter', () => {
    const href = buildNextHref('/things', { query: 'laptop', cursor: 'c2', history: '' }, 'c3');
    const url = new URL(`https://x${href}`);
    expect(url.searchParams.get('query')).toBe('laptop');
    expect(url.searchParams.get('cursor')).toBe('c3');
    expect(url.searchParams.get('history')).toBe(',c2');
  });
});

describe('buildPrevHref', () => {
  it('returns null on page 1 (no history to pop)', () => {
    expect(buildPrevHref('/things', {})).toBeNull();
  });

  it('from page 2 (history is the empty-marker for page 1), returns page 1 with no cursor', () => {
    const href = buildPrevHref('/things', { cursor: 'c2', history: '' });
    expect(href).toBe('/things');
  });

  it("from page 3, pops back to page 2's cursor", () => {
    const href = buildPrevHref('/things', { cursor: 'c3', history: ',c2' });
    expect(href).toBe('/things?cursor=c2&history=');
  });

  it('preserves an unrelated search param while popping', () => {
    const href = buildPrevHref('/things', { query: 'laptop', cursor: 'c2', history: '' });
    expect(href).toBe('/things?query=laptop');
  });
});

describe('next then prev round-trips back to the original page', () => {
  it('page 1 -> next -> prev returns to page 1', () => {
    const page1: Record<string, string | undefined> = {};
    const page2Href = buildNextHref('/things', page1, 'c2');
    const page2Params = Object.fromEntries(new URL(`https://x${page2Href}`).searchParams);

    const backToPage1 = buildPrevHref('/things', page2Params);
    expect(backToPage1).toBe('/things');
  });

  it('page 2 -> next -> prev returns to page 2', () => {
    const page2: Record<string, string | undefined> = { cursor: 'c2', history: '' };
    const page3Href = buildNextHref('/things', page2, 'c3');
    const page3Params = Object.fromEntries(new URL(`https://x${page3Href}`).searchParams);

    const backToPage2 = buildPrevHref('/things', page3Params);
    expect(backToPage2).toBe('/things?cursor=c2&history=');
  });
});
