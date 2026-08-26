// A stateless Prev/Next scheme for cursor pagination, kept entirely in the
// URL: every list page in this app is a Server Component with no client-side
// JavaScript in its chain (see the members directory's `?query=` search
// form for the same reasoning applied to search), so pagination state has
// to live in the query string rather than in memory.
//
// `history` is the list of cursors used to reach every page before the
// current one, oldest first. An empty string entry means "that page had no
// cursor" (page 1). Going forward pushes the current cursor onto history;
// going back pops the last entry off and uses it as the new cursor (an
// empty-string pop means landing back on page 1, with no cursor at all).
// Cursors are raw UUIDs (see packages/db/src/repositories/cases.ts), which
// never contain a comma, so history is joined and split on ',' with no
// further escaping needed.
export type SearchParams = Record<string, string | string[] | undefined>;

export interface PaginationParams {
  cursor: string | undefined;
  history: string[];
}

function paramString(searchParams: SearchParams, key: string): string | undefined {
  const value = searchParams[key];
  return typeof value === 'string' ? value : undefined;
}

// keyPrefix namespaces the two query params (e.g. 'mine' -> ?mineCursor=
// &mineHistory=), for the one page in this app with two independent lists
// sharing a single URL (the approvals queue's "assigned to you" and
// "available to claim" sections). Every other caller omits it and gets the
// original bare ?cursor=&history= keys.
function cursorKeyOf(keyPrefix: string): string {
  return keyPrefix ? `${keyPrefix}Cursor` : 'cursor';
}

function historyKeyOf(keyPrefix: string): string {
  return keyPrefix ? `${keyPrefix}History` : 'history';
}

export function parsePaginationParams(
  searchParams: SearchParams,
  keyPrefix = '',
): PaginationParams {
  const cursor = paramString(searchParams, cursorKeyOf(keyPrefix));
  const historyParam = paramString(searchParams, historyKeyOf(keyPrefix));
  const history = historyParam === undefined ? [] : historyParam.split(',');
  return { cursor, history };
}

function buildHref(
  basePath: string,
  searchParams: SearchParams,
  next: { cursor: string | undefined; history: string[] },
  keyPrefix: string,
): string {
  const params = new URLSearchParams();
  const cursorKey = cursorKeyOf(keyPrefix);
  const historyKey = historyKeyOf(keyPrefix);

  for (const [key, value] of Object.entries(searchParams)) {
    // Not skipped for an empty string: on a page with two independent lists
    // (keyPrefix in use), the other list's own history= can legitimately be
    // an empty string (its page-1 marker) while it sits on page 2, and
    // dropping it here would silently forget that list's position.
    if (key === cursorKey || key === historyKey || typeof value !== 'string') {
      continue;
    }
    params.set(key, value);
  }

  if (next.cursor) {
    params.set(cursorKey, next.cursor);
  }
  if (next.history.length > 0) {
    params.set(historyKey, next.history.join(','));
  }

  const query = params.toString();
  return query ? `${basePath}?${query}` : basePath;
}

// null when there is no next page (the caller already knows this from the
// API response's hasMore, and should not call this when it is false).
export function buildNextHref(
  basePath: string,
  searchParams: SearchParams,
  nextCursor: string,
  keyPrefix = '',
): string {
  const { cursor, history } = parsePaginationParams(searchParams, keyPrefix);
  return buildHref(
    basePath,
    searchParams,
    { cursor: nextCursor, history: [...history, cursor ?? ''] },
    keyPrefix,
  );
}

// null when already on page 1: nothing to go back to.
export function buildPrevHref(
  basePath: string,
  searchParams: SearchParams,
  keyPrefix = '',
): string | null {
  const { history } = parsePaginationParams(searchParams, keyPrefix);
  if (history.length === 0) {
    return null;
  }

  const popped = history[history.length - 1]!;
  return buildHref(
    basePath,
    searchParams,
    { cursor: popped === '' ? undefined : popped, history: history.slice(0, -1) },
    keyPrefix,
  );
}
