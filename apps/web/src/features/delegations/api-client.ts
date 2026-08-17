import { apiDelete, apiPost } from '../../lib/api-client';
import type { CreateDelegationInput, DelegationEntry } from './types';

export async function createDelegation(input: CreateDelegationInput): Promise<DelegationEntry> {
  const result = await apiPost<{ delegation: DelegationEntry }>('/delegations', input);
  return result.delegation;
}

export async function cancelDelegation(delegationId: string): Promise<void> {
  await apiDelete(`/delegations/${delegationId}`);
}
