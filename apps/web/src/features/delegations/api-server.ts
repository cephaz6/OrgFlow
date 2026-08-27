import { apiGet } from '../../lib/api-server';
import type { DelegationPage } from './types';

export interface FetchMyDelegationsParams {
  query?: string | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
}

export async function fetchMyDelegations(
  params?: FetchMyDelegationsParams,
): Promise<DelegationPage> {
  const search = new URLSearchParams();
  if (params?.query) {
    search.set('query', params.query);
  }
  if (params?.cursor) {
    search.set('cursor', params.cursor);
  }
  if (params?.limit) {
    search.set('limit', String(params.limit));
  }
  const queryString = search.toString();
  const path = queryString ? `/delegations?${queryString}` : '/delegations';

  return apiGet<DelegationPage>(path);
}
