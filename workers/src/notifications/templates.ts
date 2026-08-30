import type { TaskType } from '@orgflow/types';

import type { EmailMessage } from '@orgflow/email';

export interface TaskNotificationFacts {
  reference: string;
  processName: string;
  caseTitle: string;
  stepName: string;
  taskType: TaskType;
  requesterName: string;
  dueAt: string | null;
  taskId: string;
  webUrl: string;
  // Set only by handle-task-created.ts's taskAssigned branch: the raw,
  // single-use approve link a direct assignee's email carries alongside
  // the usual link to the app. Never set for a claimable (role/group) task,
  // since there is no single resolved person to scope a token to.
  approveToken?: string;
}

export interface TaskEscalatedFacts extends TaskNotificationFacts {
  escalationLevel: number;
}

export interface CaseUnassignedFacts {
  reference: string;
  processName: string;
  caseTitle: string;
  reason: string;
  caseId: string;
  webUrl: string;
}

export interface CaseCommentedFacts {
  reference: string;
  processName: string;
  caseTitle: string;
  authorName: string;
  commentBody: string;
  caseId: string;
  webUrl: string;
}

// PRD.md §14.2: subject lines lead with the reference and the action.
// The action word follows the task type, so an IT fulfilment step does not
// tell somebody their approval is needed when what is wanted is an order.
const ACTION_BY_TASK_TYPE: Record<TaskType, string> = {
  approval: 'Approval needed',
  action: 'Action needed',
  acknowledgement: 'Acknowledgement needed',
};

// Tenant-authored strings (a process name, a case title) reach the HTML
// body, so they are escaped. The text body needs no escaping, which is part
// of why both are built here rather than one being derived from the other.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDue(dueAt: string | null): string | null {
  if (!dueAt) {
    return null;
  }
  const parsed = new Date(dueAt);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  // Explicit UTC rather than the worker's local zone: the worker runs in a
  // deployed region that has nothing to do with where the recipient sits,
  // so an unqualified time would be misleading. Per-user time zones are not
  // modelled yet.
  return `${parsed.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// GOV-STANDARDS.md §8: plain English, active voice, an explicit next
// action, and a link straight to the screen that action happens on rather
// than a generic landing page (PRD.md §14.2).
export function buildTaskAssignedEmail(facts: TaskNotificationFacts): EmailMessage & {
  subject: string;
} {
  return buildTaskEmail(facts, {
    opening: `${facts.requesterName} has raised a ${facts.processName.toLowerCase()} that needs you.`,
    callToAction: 'Open the task to respond',
  });
}

// The role or group variant. Same facts, different opening, because nobody
// owns this one yet and the recipient needs to know somebody else may take
// it first.
export function buildTaskClaimableEmail(facts: TaskNotificationFacts): EmailMessage & {
  subject: string;
} {
  return buildTaskEmail(facts, {
    opening: `${facts.requesterName} has raised a ${facts.processName.toLowerCase()} waiting for your team.`,
    callToAction: 'Open the task to claim it',
    note: 'Anyone in your team can take this. Claim it first so others know you are handling it.',
  });
}

// PRD.md §15.2's reminder: purely informational, sent to whoever the task is
// already assigned to (or delegated to), not a new pool of people.
export function buildTaskReminderEmail(facts: TaskNotificationFacts): EmailMessage & {
  subject: string;
} {
  return buildTaskEmail(facts, {
    opening: `A ${facts.processName.toLowerCase()} is still waiting on you.`,
    callToAction: 'Open the task to respond',
  });
}

// PRD.md §15.3: escalation adds an assignee, it never replaces one, so this
// goes only to the escalation-level recipient, worded to say who else can
// still act rather than implying the original assignee has been dropped.
export function buildTaskEscalatedEmail(facts: TaskEscalatedFacts): EmailMessage & {
  subject: string;
} {
  return buildTaskEmail(facts, {
    opening: `A ${facts.processName.toLowerCase()} has been escalated to you (level ${facts.escalationLevel}) because it was not actioned in time.`,
    callToAction: 'Open the task to respond',
    note: 'The original assignee can still act on this too.',
  });
}

// PRD.md §7: a case that exhausts every configured escalation level (or
// otherwise cannot resolve an assignee) moves to unassigned and needs an
// administrator, not a claimable task in anyone's queue.
export function buildCaseUnassignedEmail(facts: CaseUnassignedFacts): EmailMessage & {
  subject: string;
} {
  const subject = `${facts.reference} Needs administrative action: ${facts.processName}`;
  const link = `${facts.webUrl.replace(/\/$/, '')}/cases/${facts.caseId}`;

  const lines = [
    `A ${facts.processName.toLowerCase()} could not be assigned and needs administrative attention.`,
    '',
    `Reference: ${facts.reference}`,
    `Request: ${facts.caseTitle}`,
    `Reason: ${facts.reason}`,
    '',
    `Open the case: ${link}`,
  ];

  const htmlLines = [
    `<p>A ${escapeHtml(facts.processName.toLowerCase())} could not be assigned and needs administrative attention.</p>`,
    '<ul>',
    `<li>Reference: ${escapeHtml(facts.reference)}</li>`,
    `<li>Request: ${escapeHtml(facts.caseTitle)}</li>`,
    `<li>Reason: ${escapeHtml(facts.reason)}</li>`,
    '</ul>',
    `<p><a href="${escapeHtml(link)}">Open the case</a></p>`,
  ];

  return {
    to: '',
    subject,
    textBody: lines.join('\n'),
    htmlBody: htmlLines.join('\n'),
  };
}

// A comment body can run to 4000 characters (case-comments.ts's own
// createSchema); an email is a nudge to go read the real thing, not a
// second copy of arbitrarily long tenant-authored text.
const COMMENT_PREVIEW_LENGTH = 280;

function previewOf(body: string): string {
  return body.length > COMMENT_PREVIEW_LENGTH
    ? `${body.slice(0, COMMENT_PREVIEW_LENGTH)}...`
    : body;
}

// PRD.md §14.2's usual shape, for the one notification that is not about a
// task or the case's own state: somebody left a comment. The name deliberately
// says who, since "someone commented" would send every recipient to the
// case just to find out.
export function buildCaseCommentedEmail(facts: CaseCommentedFacts): EmailMessage & {
  subject: string;
} {
  const subject = `${facts.reference} New comment: ${facts.processName}`;
  const link = `${facts.webUrl.replace(/\/$/, '')}/cases/${facts.caseId}`;
  const preview = previewOf(facts.commentBody);

  const lines = [
    `${facts.authorName} left a comment on your ${facts.processName.toLowerCase()}.`,
    '',
    `Reference: ${facts.reference}`,
    `Request: ${facts.caseTitle}`,
    '',
    `"${preview}"`,
    '',
    `Open the case: ${link}`,
  ];

  const htmlLines = [
    `<p>${escapeHtml(facts.authorName)} left a comment on your ${escapeHtml(facts.processName.toLowerCase())}.</p>`,
    '<ul>',
    `<li>Reference: ${escapeHtml(facts.reference)}</li>`,
    `<li>Request: ${escapeHtml(facts.caseTitle)}</li>`,
    '</ul>',
    `<blockquote>${escapeHtml(preview)}</blockquote>`,
    `<p><a href="${escapeHtml(link)}">Open the case</a></p>`,
  ];

  return {
    to: '',
    subject,
    textBody: lines.join('\n'),
    htmlBody: htmlLines.join('\n'),
  };
}

function buildTaskEmail(
  facts: TaskNotificationFacts,
  copy: { opening: string; callToAction: string; note?: string },
): EmailMessage {
  const subject = `${facts.reference} ${ACTION_BY_TASK_TYPE[facts.taskType]}: ${facts.processName}`;
  const link = `${facts.webUrl.replace(/\/$/, '')}/approvals/${facts.taskId}`;
  const due = formatDue(facts.dueAt);
  // A web page, not a raw API endpoint: the page itself performs the
  // GET-preview/POST-confirm split a bare link cannot, so an email security
  // scanner's pre-fetch of this URL only ever reads, never approves.
  const approveLink = facts.approveToken
    ? `${facts.webUrl.replace(/\/$/, '')}/approvals/decide/${facts.approveToken}`
    : null;

  const lines = [
    copy.opening,
    '',
    `Reference: ${facts.reference}`,
    `Request: ${facts.caseTitle}`,
    `Step: ${facts.stepName}`,
    ...(due ? [`Respond by: ${due}`] : []),
    ...(copy.note ? ['', copy.note] : []),
    '',
    `${copy.callToAction}: ${link}`,
    ...(approveLink ? ['', `Approve now: ${approveLink}`] : []),
  ];

  const htmlLines = [
    `<p>${escapeHtml(copy.opening)}</p>`,
    '<ul>',
    `<li>Reference: ${escapeHtml(facts.reference)}</li>`,
    `<li>Request: ${escapeHtml(facts.caseTitle)}</li>`,
    `<li>Step: ${escapeHtml(facts.stepName)}</li>`,
    ...(due ? [`<li>Respond by: ${escapeHtml(due)}</li>`] : []),
    '</ul>',
    ...(copy.note ? [`<p>${escapeHtml(copy.note)}</p>`] : []),
    `<p><a href="${escapeHtml(link)}">${escapeHtml(copy.callToAction)}</a></p>`,
    ...(approveLink ? [`<p><a href="${escapeHtml(approveLink)}">Approve now</a></p>`] : []),
  ];

  return {
    to: '',
    subject,
    textBody: lines.join('\n'),
    htmlBody: htmlLines.join('\n'),
  };
}
