import { apiGet } from '../../lib/api-server';
import type { DelegationEntry, DelegationPage } from './types';

export async function fetchMyDelegations(): Promise<DelegationEntry[]> {
  const page = await apiGet<DelegationPage>('/delegations');
  return page.data;
}
