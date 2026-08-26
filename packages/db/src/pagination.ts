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
