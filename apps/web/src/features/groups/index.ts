// The feature's single public surface (ADR-0008).
export {
  addGroupMember,
  createGroup,
  deleteGroup,
  removeGroupMember,
  updateGroup,
} from './api-client';
export { fetchGroupDetail, fetchGroups } from './api-server';
export { GroupForm } from './group-form';
export { GroupList } from './group-list';
export { GroupMembers } from './group-members';
export type { CreateGroupInput, Group, GroupDetail, GroupMember, UpdateGroupInput } from './types';
