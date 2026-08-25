// The library surface, deliberately free of side effects: the process entry
// point lives in main.ts, so importing a handler in a test does not start a
// consumer polling a queue.
export { dispatchDomainEvent } from './notifications/dispatch.js';
export { handleTaskCreated } from './notifications/handle-task-created.js';
export type { NotificationDeps } from './notifications/handle-task-created.js';
export { buildTaskAssignedEmail, buildTaskClaimableEmail } from './notifications/templates.js';
export type { TaskNotificationFacts } from './notifications/templates.js';
export { resolveEmailSender } from './email/resolve-sender.js';
// The sender interface, its dummy and its SES implementation moved to
// @orgflow/email, since apps/api needs the same construction-time choice
// for invitation delivery and could not reach it while it lived only here
// (CLAUDE.md §3 dependency direction: api and workers are peers). Import
// from @orgflow/email directly rather than through this re-export.
export { createSqsClient, parseDomainEvent, pollOnce, runConsumer } from './sqs/consumer.js';
export type { ConsumerConfig, PollResult } from './sqs/consumer.js';
export { createLogger } from './logger.js';
export type { Logger } from './logger.js';
