import type { DomainEvent } from '@orgflow/types';

import { handleCaseCommented } from './handle-case-commented.js';
import { handleCaseUnassigned } from './handle-case-unassigned.js';
import { handleTaskCreated, type NotificationDeps } from './handle-task-created.js';
import { handleTaskEscalated } from './handle-task-escalated.js';
import { handleTaskReminderDue } from './handle-task-reminder-due.js';

// PRD.md §10 consumer contract: unknown event types are ignored, not
// errored, for forward compatibility. The topic fans every domain event out
// to every subscribed queue, so this consumer sees types it has no opinion
// on from the day another producer adds one, and erroring on them would
// dead-letter perfectly valid traffic.
//
// The rest of PRD.md §14.1's templates arrive with the phases that trigger
// them, and a handler that sent nothing would be worse than none at all.
const HANDLED: Record<string, (deps: NotificationDeps, event: DomainEvent) => Promise<unknown>> = {
  'task.created': handleTaskCreated,
  'task.reminderDue': handleTaskReminderDue,
  'task.escalated': handleTaskEscalated,
  'case.unassigned': handleCaseUnassigned,
  'case.commented': handleCaseCommented,
};

export async function dispatchDomainEvent(
  deps: NotificationDeps,
  event: DomainEvent,
): Promise<{ handled: boolean }> {
  const handler = HANDLED[event.eventType];

  if (!handler) {
    deps.logger.debug(
      { eventId: event.eventId, eventType: event.eventType },
      'no notification handler for this event type; ignoring',
    );
    return { handled: false };
  }

  await handler(deps, event);
  return { handled: true };
}
