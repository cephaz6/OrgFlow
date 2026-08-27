import { createDb } from '@orgflow/db';
import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent, SQSRecord } from 'aws-lambda';

import type { AttachmentScanDeps } from './attachment-scan/handle-attachment-uploaded.js';
import { dispatchAttachmentScanEvent } from './attachment-scan/dispatch.js';
import { loadConfig } from './config/env.js';
import { resolvePublisher } from './events/resolve-publisher.js';
import { createLogger, type Logger } from './logger.js';
import { parseDomainEvent } from './sqs/consumer.js';
import { resolveFileStore } from './storage/resolve-file-store.js';

// lambda-handler.ts's own counterpart for the attachment-scan queue.
// Bundled as its own CDK NodejsFunction entry point (PR4), separate from
// the notifications one, for the same independent-scaling-and-redrive
// reasoning as attachment-scan-main.ts.
let deps: AttachmentScanDeps | undefined;

function resolveDeps(logger: Logger): AttachmentScanDeps {
  if (deps) {
    return deps;
  }

  const config = loadConfig();
  deps = {
    db: createDb({ connectionString: config.ORGFLOW_DATABASE_URL }),
    fileStore: resolveFileStore(config, logger),
    publisher: resolvePublisher(config, logger),
    logger,
  };
  return deps;
}

async function handleRecord(
  record: SQSRecord,
  scanDeps: AttachmentScanDeps,
  logger: Logger,
): Promise<SQSBatchItemFailure | null> {
  const event = parseDomainEvent(record.body, logger);

  if (!event) {
    return null;
  }

  try {
    await dispatchAttachmentScanEvent(scanDeps, event);
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
  const logger = createLogger(loadConfig().ORGFLOW_LOG_LEVEL);
  const scanDeps = resolveDeps(logger);

  // Sequential, not Promise.all, matching lambda-handler.ts's own choice:
  // a batch of at most ten messages does not need concurrency, and running
  // them concurrently would let one slow scan hold up the whole batch's
  // timeout budget for no benefit.
  const failures: SQSBatchItemFailure[] = [];
  for (const record of event.Records) {
    const failure = await handleRecord(record, scanDeps, logger);
    if (failure) {
      failures.push(failure);
    }
  }

  return { batchItemFailures: failures };
}
