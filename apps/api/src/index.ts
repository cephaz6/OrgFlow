import { createDb } from '@orgflow/db';
import { createMongoClient, ensureIndexes } from '@orgflow/documents';
import { createDummyPublisher, createSnsPublisher } from '@orgflow/events';
import type { DomainEventPublisher } from '@orgflow/events';

import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { resolveEmailSender } from './email/resolve-sender.js';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';
import { startSlaSweep } from './sla/sweep.js';

// ADR-0008 and the 3pservice pattern: the transport is a construction-time
// choice behind one interface. Which one was chosen is logged rather than
// left implicit, because "no notifications arrived" and "events went to a
// dummy" look identical from the outside otherwise.
function createPublisher(
  config: ReturnType<typeof loadConfig>,
  logger: Logger,
): DomainEventPublisher {
  if (!config.ORGFLOW_EVENTS_TOPIC_ARN) {
    logger.warn(
      'ORGFLOW_EVENTS_TOPIC_ARN is not set; domain events go to the dummy publisher and reach no consumer',
    );
    return createDummyPublisher();
  }

  logger.info({ topicArn: config.ORGFLOW_EVENTS_TOPIC_ARN }, 'publishing domain events to SNS');
  return createSnsPublisher({
    topicArn: config.ORGFLOW_EVENTS_TOPIC_ARN,
    region: config.ORGFLOW_AWS_REGION,
    endpoint: config.ORGFLOW_AWS_ENDPOINT,
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.ORGFLOW_LOG_LEVEL);

  try {
    const db = createDb({ connectionString: config.ORGFLOW_DATABASE_URL });
    const mongoClient = await createMongoClient({ uri: config.ORGFLOW_MONGODB_URI });
    await ensureIndexes(mongoClient);

    const publisher = createPublisher(config, logger);
    const emailSender = resolveEmailSender(config, logger);

    const app = createApp({
      db,
      mongoClient,
      publisher,
      emailSender,
      corsOrigin: config.ORGFLOW_WEB_URL,
      logger,
      sessionSecret: config.ORGFLOW_SESSION_SECRET,
      isLocal: config.ORGFLOW_ENV === 'local',
      apiBaseUrl: `http://localhost:${config.ORGFLOW_API_PORT}`,
      platformOidc:
        config.ORGFLOW_OIDC_ISSUER_URL &&
        config.ORGFLOW_OIDC_CLIENT_ID &&
        config.ORGFLOW_OIDC_CLIENT_SECRET
          ? {
              issuerUrl: config.ORGFLOW_OIDC_ISSUER_URL,
              clientId: config.ORGFLOW_OIDC_CLIENT_ID,
              clientSecret: config.ORGFLOW_OIDC_CLIENT_SECRET,
            }
          : undefined,
    });

    // The local substitute for PRD.md §15.2's EventBridge Scheduler (see
    // sla/sweep.ts): polls sla_timers for due reminders and escalations for
    // as long as this process runs.
    startSlaSweep({ db, mongoClient, publisher, logger });

    app.listen(config.ORGFLOW_API_PORT, () => {
      logger.info({ port: config.ORGFLOW_API_PORT }, 'apps/api listening');
    });
  } catch (err) {
    logger.fatal({ err }, 'failed to start apps/api');
    process.exit(1);
  }
}

void main();
