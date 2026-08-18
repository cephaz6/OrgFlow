// A minimal RFC 4180 writer. The export this feature produces has a fixed,
// known-shape set of columns, so a dependency for this is not worth
// CLAUDE.md §8's "adding a dependency" cost: the only real complexity is
// quoting a field that contains a comma, a quote, or a line break, and
// doubling an embedded quote.
function escapeCsvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsv(header: string[], rows: (string | number | null)[][]): string {
  const lines = [header, ...rows].map((row) =>
    row.map((cell) => escapeCsvField(cell === null ? '' : String(cell))).join(','),
  );
  // CRLF per RFC 4180, and what a spreadsheet application expects without
  // a byte-order-mark dance.
  return lines.join('\r\n') + '\r\n';
}
