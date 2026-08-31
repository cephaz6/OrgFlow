// A stable slug from a display name: lower-cased, non-alphanumerics
// collapsed to single hyphens, leading/trailing hyphens trimmed. Shared by
// every route that derives a stable key from a name it is not asked for
// separately (organisations, process definitions, groups); the caller's
// own unique constraint is what actually guards uniqueness, this is just
// what turns "Laptop Request" into 'laptop-request' before that constraint
// gets to decide.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
