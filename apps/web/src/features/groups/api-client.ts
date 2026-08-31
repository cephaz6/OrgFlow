import { apiDelete, apiPatch, apiPost } from '../../lib/api-client';
import type { CreateGroupInput, Group, GroupMember, UpdateGroupInput } from './types';

export async function createGroup(input: CreateGroupInput): Promise<Group> {
  return apiPost<Group>('/groups', input);
}

export async function updateGroup(groupId: string, input: UpdateGroupInput): Promise<Group> {
  return apiPatch<Group>(`/groups/${groupId}`, input);
}

export async function deleteGroup(groupId: string): Promise<void> {
  await apiDelete(`/groups/${groupId}`);
}

export async function addGroupMember(
  groupId: string,
  userId: string,
): Promise<{ members: GroupMember[] }> {
  return apiPost<{ members: GroupMember[] }>(`/groups/${groupId}/members`, { userId });
}

export async function removeGroupMember(groupId: string, userId: string): Promise<void> {
  await apiDelete(`/groups/${groupId}/members/${userId}`);
}
