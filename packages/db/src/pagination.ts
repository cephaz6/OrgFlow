// PRD.md §11.10: cursor-based pagination everywhere, `?limit&cursor` ->
// `{ data, nextCursor, hasMore }`. This clamp is the one piece every
// cursor-paginated repository function shares; extracted here (rather than
// each function re-deriving its own Math.min/Math.max) so the default and
// the ceiling cannot drift between lists.
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export function clampPageSize(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
}

// A cursor for a list that is not ordered by a single time-sortable id
// (findCasesForCurrentTenant's raw-id cursor), but by some other column a
// person actually wants to scan by (a directory ordered alphabetically, a
// catalogue ordered by name). The id is carried alongside purely as a
// tie-breaker for two rows that share the same ordering-column value; the
// whole thing is opaque to the caller, which only ever echoes it back.
export function encodeCompositeCursor<T extends Record<string, string>>(cursor: T): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

// Lenient rather than throwing: a cursor only ever comes from this
// module's own encodeCompositeCursor, so a value that fails to decode is
// treated as "start from page 1" rather than a request the caller has to
// handle an error for.
export function decodeCompositeCursor<T extends Record<string, string>>(
  raw: string,
  keys: readonly (keyof T & string)[],
): T | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    for (const key of keys) {
      if (typeof (parsed as Record<string, unknown>)[key] !== 'string') {
        return null;
      }
    }
    return parsed as T;
  } catch {
    return null;
  }
}
