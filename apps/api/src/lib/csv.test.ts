import { describe, expect, it } from 'vitest';

import { toCsv } from './csv.js';

describe('toCsv', () => {
  it('joins the header and rows with CRLF', () => {
    const csv = toCsv(['Reference', 'Title'], [['LAP-000001', 'MacBook Pro']]);

    expect(csv).toBe('Reference,Title\r\nLAP-000001,MacBook Pro\r\n');
  });

  it('quotes a field containing a comma', () => {
    const csv = toCsv(['Title'], [['MacBook Pro, 14-inch']]);

    expect(csv).toContain('"MacBook Pro, 14-inch"');
  });

  it('doubles an embedded quote and wraps the field', () => {
    const csv = toCsv(['Title'], [['The "good" laptop']]);

    expect(csv).toContain('"The ""good"" laptop"');
  });

  it('quotes a field containing a line break', () => {
    const csv = toCsv(['Title'], [['Line one\nLine two']]);

    expect(csv).toContain('"Line one\nLine two"');
  });

  it('renders null as an empty field, unquoted', () => {
    const csv = toCsv(['Title', 'Completed at'], [['MacBook Pro', null]]);

    expect(csv).toBe('Title,Completed at\r\nMacBook Pro,\r\n');
  });

  it('leaves a plain field unquoted', () => {
    const csv = toCsv(['Status'], [['completed']]);

    expect(csv).toBe('Status\r\ncompleted\r\n');
  });
});
