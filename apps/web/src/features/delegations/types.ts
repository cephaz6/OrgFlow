export interface DelegationEntry {
  delegationId: string;
  fromUserId: string;
  toUserId: string;
  // Which side of the row the caller is on: 'outgoing' is work the caller
  // handed to someone else, 'incoming' is work handed to the caller.
  direction: 'outgoing' | 'incoming';
  counterpartName: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  createdAt: string;
}

export interface DelegationPage {
  data: DelegationEntry[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CreateDelegationInput {
  toUserEmail: string;
  startsAt: string;
  endsAt: string;
  reason?: string;
}
