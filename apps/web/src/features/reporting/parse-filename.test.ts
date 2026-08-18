import { describe, expect, it } from 'vitest';

import { parseFilename } from './parse-filename';

describe('parseFilename', () => {
  it('extracts the filename from a Content-Disposition header', () => {
    expect(parseFilename('attachment; filename="orgflow-export-123.csv"')).toBe(
      'orgflow-export-123.csv',
    );
  });

  it('returns null when the header is absent', () => {
    expect(parseFilename(null)).toBeNull();
  });

  it('returns null when the header carries no filename', () => {
    expect(parseFilename('attachment')).toBeNull();
  });
});
