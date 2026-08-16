// Imported from the specific modules, not the ../cases barrel: that barrel
// also re-exports the API client, which validates NEXT_PUBLIC_ORGFLOW_API_URL
// at import time and would make this pure function untestable without a
// configured environment.
import { isReturnedToRequester } from '../cases/case-state';
import type { CaseResponse } from '../cases/types';

// Pure, and in its own module rather than beside the component that renders
// it, for the same reason urgency.ts sits apart from approval-queue.tsx: it
// is the only part with real logic, and a unit test should be able to import
// it without dragging JSX through a transform that is not configured for it.
//
// Open cases only, ordered so the ones needing the requester's attention
// come first. A returned case is the only state on this list they can
// actually act on, so it leads regardless of age.
export function selectOpenRequests(cases: CaseResponse[]): CaseResponse[] {
  return cases
    .filter((entry) => entry.status === 'active' || entry.status === 'unassigned')
    .sort((a, b) => {
      const aReturned = isReturnedToRequester(a);
      const bReturned = isReturnedToRequester(b);
      if (aReturned !== bReturned) {
        return aReturned ? -1 : 1;
      }
      // Then most recently submitted, so the thing they just did is at the
      // top rather than buried under months of older work.
      return (b.submittedAt ?? '').localeCompare(a.submittedAt ?? '');
    });
}
