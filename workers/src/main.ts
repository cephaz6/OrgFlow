import { createDb } from '@orgflow/db';

import { loadConfig } from './config/env.js';
import { createDummyEmailSender } from './email/dummy-sender.js';
import type { EmailSender } from './email/sender.js';
import { createSesSender } from './email/ses-sender.js';
import { createLogger, type Logger } from './logger.js';
import { dispatchDomainEvent } from './notifications/dispatch.js';
import { createSqsClient, runConsumer } from './sqs/consumer.js';

// ADR-0008 and the 3pservice pattern. Which implementation was built is
// logged rather than left implicit, because "no email arrived" and "email
// went to a dummy" look identical from the outside otherwise.
function createEmailSender(config: ReturnType<typeof loadConfig>, logger: Logger): EmailSender {
  if (!config.ORGFLOW_SES_FROM_ADDRESS) {
    logger.warn('ORGFLOW_SES_FROM_ADDRESS is not set; email goes to the dummy sender');
    return createDummyEmailSender();
  }

  logger.info({ from: config.ORGFLOW_SES_FROM_ADDRESS }, 'sending email through SES');
  return createSesSender({
    fromAddress: config.ORGFLOW_SES_FROM_ADDRESS,
    region: config.ORGFLOW_AWS_REGION,
    endpoint: config.ORGFLOW_AWS_ENDPOINT,
  });
}

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
    emailSender: createEmailSender(config, logger),
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
