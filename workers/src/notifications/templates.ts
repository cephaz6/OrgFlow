import type { TaskType } from '@orgflow/types';

import type { EmailMessage } from '../email/sender.js';

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

function buildTaskEmail(
  facts: TaskNotificationFacts,
  copy: { opening: string; callToAction: string; note?: string },
): EmailMessage {
  const subject = `${facts.reference} ${ACTION_BY_TASK_TYPE[facts.taskType]}: ${facts.processName}`;
  const link = `${facts.webUrl.replace(/\/$/, '')}/approvals/${facts.taskId}`;
  const due = formatDue(facts.dueAt);

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
  ];

  return {
    to: '',
    subject,
    textBody: lines.join('\n'),
    htmlBody: htmlLines.join('\n'),
  };
}
