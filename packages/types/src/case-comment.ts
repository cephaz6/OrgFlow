import type { IsoDateTimeString, Uuid } from './common.js';

// 'approvers' is an internal note: visible to anyone who can view the case
// for a reason other than being its submitter (an assignee, past or
// present, a process owner, or an admin), never to the requester. 'all' is
// visible to everyone who can see the case at all, submitter included.
export type CommentVisibility = 'all' | 'approvers';

export interface CaseComment {
  commentId: Uuid;
  organisationId: Uuid;
  caseId: Uuid;
  authorUserId: Uuid;
  body: string;
  visibility: CommentVisibility;
  createdAt: IsoDateTimeString;
}
