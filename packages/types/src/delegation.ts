import type { IsoDateTimeString, Uuid } from './common.js';

// PRD.md §2.5/§7: "delegation is applied at resolution time." A row here
// covering `now` redirects a task resolved to from_user_id over to
// to_user_id instead, recorded on the task as delegated_from_user_id.
export interface Delegation {
  delegationId: Uuid;
  organisationId: Uuid;
  fromUserId: Uuid;
  toUserId: Uuid;
  startsAt: IsoDateTimeString;
  endsAt: IsoDateTimeString;
  reason: string | null;
  createdAt: IsoDateTimeString;
}
