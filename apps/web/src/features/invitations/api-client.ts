import { apiDelete, apiPost } from '../../lib/api-client';
import type { CreateInvitationInput, InvitationEntry } from './types';

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<{ invitation: InvitationEntry; inviteUrl: string }> {
  return apiPost<{ invitation: InvitationEntry; inviteUrl: string }>('/invitations', input);
}

export async function revokeInvitation(invitationId: string): Promise<void> {
  await apiDelete(`/invitations/${invitationId}`);
}

export async function acceptInvitation(
  token: string,
): Promise<{ organisationId: string; organisationName: string | null }> {
  return apiPost<{ organisationId: string; organisationName: string | null }>(
    `/invitations/${token}/accept`,
  );
}
