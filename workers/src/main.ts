import { createDb } from '@orgflow/db';

import { loadConfig } from './config/env.js';
import { resolveEmailSender } from './email/resolve-sender.js';
import { createLogger } from './logger.js';
import { dispatchDomainEvent } from './notifications/dispatch.js';
import { createSqsClient, runConsumer } from './sqs/consumer.js';

// The local development driver: `pnpm dev` runs this against LocalStack,
// self-managing the receive/handle/delete loop. In a deployed environment
// AWS itself pulls messages off the same queue and invokes
// lambda-handler.ts instead (TECH-STACK.md §6); dispatchDomainEvent is the
// part shared between the two, so what a message does never depends on
// which one delivered it.
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.ORGFLOW_LOG_LEVEL);

  if (!config.ORGFLOW_NOTIFICATIONS_QUEUE_URL) {
    logger.fatal(
      'ORGFLOW_NOTIFICATIONS_QUEUE_URL is not set; there is no queue to consume. Exiting rather than idling silently.',
    );
    process.exit(1);
  }

  const db = createDb({ connectionString: config.ORGFLOW_DATABASE_URL });
  const deps = {
    db,
    emailSender: resolveEmailSender(config, logger),
    webUrl: config.ORGFLOW_WEB_URL,
    logger,
  };

  const client = createSqsClient({
    region: config.ORGFLOW_AWS_REGION,
    endpoint: config.ORGFLOW_AWS_ENDPOINT,
  });

  // Stop after the current poll cycle rather than mid-message, so a message
  // being handled is either finished and deleted or left for redelivery,
  // never half-processed with its delete already issued.
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
      queueUrl: config.ORGFLOW_NOTIFICATIONS_QUEUE_URL,
      region: config.ORGFLOW_AWS_REGION,
      endpoint: config.ORGFLOW_AWS_ENDPOINT,
    },
    (event) => dispatchDomainEvent(deps, event),
    logger,
    () => running,
  );

  await db.destroy();
}

void main();
