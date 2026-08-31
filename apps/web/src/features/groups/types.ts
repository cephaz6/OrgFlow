export interface Group {
  groupId: string;
  key: string;
  name: string;
  description: string | null;
}

export interface GroupMember {
  userId: string;
  displayName: string;
  email: string;
}

// GET /groups/:groupId's shape: the group plus who is in it, gated to
// admin unlike the plain Group list above (a member list carries email
// addresses).
export interface GroupDetail extends Group {
  members: GroupMember[];
}

export interface CreateGroupInput {
  name: string;
  description?: string | null;
}

export interface UpdateGroupInput {
  name?: string;
  description?: string | null;
}
