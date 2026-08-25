import { apiPost } from '../../lib/api-client';
import type { OrganisationSummary } from './types';

export async function createOrganisation(name: string): Promise<OrganisationSummary> {
  const result = await apiPost<{ organisation: OrganisationSummary }>('/organisations', { name });
  return result.organisation;
}
