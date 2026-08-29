import { apiDelete, apiPatch, apiPost } from '../../lib/api-client';
import type {
  CreateIdentityProviderInput,
  IdentityProviderEntry,
  UpdateIdentityProviderInput,
} from './types';

export async function createIdentityProvider(
  input: CreateIdentityProviderInput,
): Promise<IdentityProviderEntry> {
  return apiPost<IdentityProviderEntry>('/identity-providers', input);
}

export async function updateIdentityProvider(
  providerId: string,
  input: UpdateIdentityProviderInput,
): Promise<IdentityProviderEntry> {
  return apiPatch<IdentityProviderEntry>(`/identity-providers/${providerId}`, input);
}

export async function deleteIdentityProvider(providerId: string): Promise<void> {
  await apiDelete(`/identity-providers/${providerId}`);
}
