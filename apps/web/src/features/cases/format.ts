// One place for date rendering, so a case list and a timeline cannot
// disagree about what a timestamp looks like.
//
// en-GB explicitly rather than the visitor's locale: a server-rendered
// string formatted with the server's locale and then hydrated with the
// browser's produces a hydration mismatch, and the product is British
// English throughout (CLAUDE.md §5.1). UTC for the same reason: the server
// and the browser are not necessarily in the same timezone, and a date that
// silently shifts by a day between render and hydration is worse than one
// that is consistently UTC.
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const DATE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

export function formatDate(iso: string): string {
  return DATE.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return `${DATE_TIME.format(new Date(iso))} UTC`;
}
