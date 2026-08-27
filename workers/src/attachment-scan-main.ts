import { createDb } from '@orgflow/db';

import { dispatchAttachmentScanEvent } from './attachment-scan/dispatch.js';
import { loadConfig } from './config/env.js';
import { resolvePublisher } from './events/resolve-publisher.js';
import { createLogger } from './logger.js';
import { createSqsClient, runConsumer } from './sqs/consumer.js';
import { resolveFileStore } from './storage/resolve-file-store.js';

// main.ts's own counterpart, one entry point per queue rather than one
// process polling two: an independent redrive policy and independent
// scaling for the scan path, matching how PR4's CDK stack subscribes a
// separate SQS queue to the same events topic (see .env.example's
// ORGFLOW_ATTACHMENTS_SCAN_QUEUE_URL comment).
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.ORGFLOW_LOG_LEVEL);

  if (!config.ORGFLOW_ATTACHMENTS_SCAN_QUEUE_URL) {
    logger.fatal(
      'ORGFLOW_ATTACHMENTS_SCAN_QUEUE_URL is not set; there is no queue to consume. Exiting rather than idling silently.',
    );
    process.exit(1);
  }

  const db = createDb({ connectionString: config.ORGFLOW_DATABASE_URL });
  const deps = {
    db,
    fileStore: resolveFileStore(config, logger),
    publisher: resolvePublisher(config, logger),
    logger,
  };

  const client = createSqsClient({
    region: config.ORGFLOW_AWS_REGION,
    endpoint: config.ORGFLOW_AWS_ENDPOINT,
  });

  let running = true;
  const stop = (signal: string) => {
    logger.info({ signal }, 'shutting down after the current poll cycle');
    running = false;
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  await runConsumer(
    client,
    {
      queueUrl: config.ORGFLOW_ATTACHMENTS_SCAN_QUEUE_URL,
      region: config.ORGFLOW_AWS_REGION,
      endpoint: config.ORGFLOW_AWS_ENDPOINT,
    },
    (event) => dispatchAttachmentScanEvent(deps, event),
    logger,
    () => running,
  );

  await db.destroy();
}

void main();
