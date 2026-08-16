import { apiPost } from '../../lib/api-client';

export interface CaseResponse {
  caseId: string;
  reference: string;
  title: string;
  status: string;
  outcome: string | null;
  currentStepKey: string | null;
}

interface CaseEnvelope {
  case: CaseResponse;
}

// Two calls, not one, because the API has no create-and-submit endpoint and
// should not grow one: PRD.md §8.2 pins the definition version at
// submission, and keeping submission its own step is what makes that moment
// explicit rather than a side effect of creating a record.
export async function submitNewCase(
  definitionId: string,
  values: Record<string, unknown>,
): Promise<CaseResponse> {
  const created = await apiPost<CaseEnvelope>('/cases', { definitionId, values });
  const submitted = await apiPost<CaseEnvelope>(`/cases/${created.case.caseId}/submit`);
  return submitted.case;
}
