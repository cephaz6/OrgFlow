import { apiPost } from '../../lib/api-client';
import type { CaseEnvelope, CaseResponse } from './types';

// Browser-side mutations, called from the form runtime and the case
// actions. Nothing here may import api-server.ts.

export async function submitNewCase(
  definitionId: string,
  values: Record<string, unknown>,
): Promise<CaseResponse> {
  // Two calls, not one, because the API has no create-and-submit endpoint
  // and should not grow one: PRD.md §8.2 pins the definition version at
  // submission, and keeping submission its own step is what makes that
  // moment explicit rather than a side effect of creating a record.
  const created = await apiPost<CaseEnvelope>('/cases', { definitionId, values });
  const submitted = await apiPost<CaseEnvelope>(`/cases/${created.case.caseId}/submit`);
  return submitted.case;
}

export async function cancelCase(caseId: string, reason: string): Promise<CaseResponse> {
  const response = await apiPost<CaseEnvelope>(`/cases/${caseId}/cancel`, { reason });
  return response.case;
}

export async function resubmitCase(
  caseId: string,
  values: Record<string, unknown>,
): Promise<CaseResponse> {
  const response = await apiPost<CaseEnvelope>(`/cases/${caseId}/resubmit`, { values });
  return response.case;
}
