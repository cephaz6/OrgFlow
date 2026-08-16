import { createDb } from '@orgflow/db';
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

import { loadConfig } from './config/env.js';
import { resolveEmailSender } from './email/resolve-sender.js';
import { createLogger, type Logger } from './logger.js';
import { dispatchDomainEvent } from './notifications/dispatch.js';
import { parseDomainEvent } from './sqs/consumer.js';
import type { NotificationDeps } from './notifications/handle-task-created.js';

// The deployed counterpart to main.ts's local poll loop (TECH-STACK.md §6:
// "Lambda functions, event source mappings"). Bundled directly as the CDK
// NodejsFunction entry point in infra/src/stacks/workers-stack.ts, which is
// why this exists as its own file rather than a new export on index.ts:
// index.ts is the library surface consumed by tests, and CDK instead needs
// a path on disk it can hand to esbuild.
//
// AWS itself calls ReceiveMessage and DeleteMessage for an SQS event source
// mapping; this function never does either. What it decides is which
// records succeeded and which failed, returned as batchItemFailures so the
// event source mapping (configured with reportBatchItemFailures) retries
// only the failed ones rather than the whole batch. That is the Lambda
// equivalent of pollOnce's per-message delete: a record dispatchDomainEvent
// handles without throwing is done; one that throws is left for
// redelivery, and eventually the queue's own redrive policy dead-letters it
// (MessagingStack, maxReceiveCount: 5).
//
// deps is a module-scope lazy singleton rather than constructed inside the
// handler on every invocation. Lambda reuses a warm execution environment
// across invocations, and the whole point of a persistent `db` connection
// (as opposed to opening one per call) is that reuse; constructing it
// per-invocation would pay a connection-setup cost every request gained
// nothing from paying. It is never torn down: there is no reliable
// pre-freeze hook to call db.destroy() from, so the connection lives until
// AWS reclaims the execution environment, same as any other Lambda-held
// resource.
let deps: NotificationDeps | undefined;

function resolveDeps(logger: Logger): NotificationDeps {
  if (deps) {
    return deps;
  }

  const config = loadConfig();
  deps = {
    db: createDb({ connectionString: config.ORGFLOW_DATABASE_URL }),
    emailSender: resolveEmailSender(config, logger),
    webUrl: config.ORGFLOW_WEB_URL,
    logger,
  };
  return deps;
}

async function handleRecord(
  record: SQSRecord,
  notificationDeps: NotificationDeps,
  logger: Logger,
): Promise<SQSBatchItemFailure | null> {
  const event = parseDomainEvent(record.body, logger);

  if (!event) {
    // Unparseable, exactly as pollOnce treats it: retrying cannot help, so
    // this counts as handled rather than being reported as a failure that
    // would only cycle back for redelivery and fail identically forever.
    return null;
  }

  try {
    await dispatchDomainEvent(notificationDeps, event);
    return null;
  } catch (err) {
    logger.error(
      { err, eventId: event.eventId, eventType: event.eventType },
      'handler failed; reporting this message for redelivery',
    );
    return { itemIdentifier: record.messageId };
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  // A fresh logger per invocation, matching every other entry point in
  // this codebase (ADR-0001's sibling convention: config and logging are
  // resolved at the boundary, not held as ambient state).
  const logger = createLogger(loadConfig().ORGFLOW_LOG_LEVEL);
  const notificationDeps = resolveDeps(logger);

  // Deliberately sequential rather than Promise.all: these are notification
  // emails, not a latency-sensitive path, and running them concurrently
  // would let one slow send hold up the whole batch's timeout budget
  // without buying anything a batch of at most ten messages needs.
  const failures: SQSBatchItemFailure[] = [];
  for (const record of event.Records) {
    const failure = await handleRecord(record, notificationDeps, logger);
    if (failure) {
      failures.push(failure);
    }
  }

  return { batchItemFailures: failures };
}
