import type { CatalogueEntry } from '../catalogue/api';
import type { CaseResponse } from '../cases/types';

// Pure, for the same reason select-open-requests.ts is: the only real logic
// here, importable without dragging in the API client's environment
// validation.
//
// PRD.md §13.2 asks for "quick-start tiles for frequent processes".
// Frequency used to be unmeasured, so the tiles fell back to catalogue
// order. It is measured now: how many times this requester has actually
// started each process, counted from their own case history rather than a
// guess like "most recently published". A process never started sorts
// after every process that has been, in catalogue order among themselves,
// so the tiles never look empty for someone new to the organisation.
export function sortCatalogueByFrequency(
  entries: CatalogueEntry[],
  cases: CaseResponse[],
): CatalogueEntry[] {
  const counts = new Map<string, number>();
  for (const entry of cases) {
    counts.set(entry.definitionId, (counts.get(entry.definitionId) ?? 0) + 1);
  }

  return [...entries].sort((a, b) => {
    const aCount = counts.get(a.definitionId) ?? 0;
    const bCount = counts.get(b.definitionId) ?? 0;
    return bCount - aCount;
  });
}
