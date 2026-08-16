// The library surface, deliberately free of side effects: the process entry
// point lives in main.ts, so importing a handler in a test does not start a
// consumer polling a queue.
export { dispatchDomainEvent } from './notifications/dispatch.js';
export { handleTaskCreated } from './notifications/handle-task-created.js';
export type { NotificationDeps } from './notifications/handle-task-created.js';
export { buildTaskAssignedEmail, buildTaskClaimableEmail } from './notifications/templates.js';
export type { TaskNotificationFacts } from './notifications/templates.js';
export { createDummyEmailSender } from './email/dummy-sender.js';
export type { DummyEmailSender } from './email/dummy-sender.js';
export { createSesSender } from './email/ses-sender.js';
export type { SesSenderConfig } from './email/ses-sender.js';
export type { EmailMessage, EmailSender } from './email/sender.js';
export { createSqsClient, parseDomainEvent, pollOnce, runConsumer } from './sqs/consumer.js';
export type { ConsumerConfig, PollResult } from './sqs/consumer.js';
export { createLogger } from './logger.js';
export type { Logger } from './logger.js';
