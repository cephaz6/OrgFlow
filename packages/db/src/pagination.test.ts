import { describe, expect, it } from 'vitest';

import { clampPageSize, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './pagination.js';

describe('clampPageSize', () => {
  it('defaults to DEFAULT_PAGE_SIZE when no limit is given', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('passes a limit within range through unchanged', () => {
    expect(clampPageSize(10)).toBe(10);
  });

  it('raises a limit below 1 up to 1', () => {
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-5)).toBe(1);
  });

  it('caps a limit above MAX_PAGE_SIZE', () => {
    expect(clampPageSize(1000)).toBe(MAX_PAGE_SIZE);
  });

  it('accepts exactly MAX_PAGE_SIZE', () => {
    expect(clampPageSize(MAX_PAGE_SIZE)).toBe(MAX_PAGE_SIZE);
  });
});
