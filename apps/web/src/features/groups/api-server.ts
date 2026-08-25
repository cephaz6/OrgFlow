import { apiGet } from '../../lib/api-server';
import type { Group } from './types';

interface GroupsResponse {
  data: Group[];
}

export async function fetchGroups(): Promise<Group[]> {
  const response = await apiGet<GroupsResponse>('/groups');
  return response.data;
}
