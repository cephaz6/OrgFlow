import { apiDelete, apiPatch } from '../../lib/api-client';
import type { MemberEntry, UpdateMemberInput } from './types';

export async function updateMember(userId: string, input: UpdateMemberInput): Promise<MemberEntry> {
  return apiPatch<MemberEntry>(`/members/${userId}`, input);
}

export async function removeMember(userId: string): Promise<void> {
  await apiDelete(`/members/${userId}`);
}
