import { createHash } from 'node:crypto';

// JSON.stringify preserves insertion order, so two objects that are equal
// but were built in a different order would serialise differently and hash
// differently. Sorting keys at every level makes the hash a function of the
// document's content alone, which is the only thing that makes it useful as
// the integrity check PRD.md §2.2 describes.
//
// Arrays keep their order: in a definition document order is meaningful
// (transition rules are evaluated first-match-wins, per §5.4), so sorting
// them would discard information rather than normalise it.
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalise);
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      // undefined disappears under JSON.stringify anyway; dropping it here
      // keeps a key that is absent and a key that is explicitly undefined
      // hashing identically.
      if (source[key] !== undefined) {
        sorted[key] = canonicalise(source[key]);
      }
    }
    return sorted;
  }

  return value;
}

export function hashDocument(document: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalise(document)))
    .digest('hex');
}
