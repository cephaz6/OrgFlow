import {
  createDummyPublisher,
  createSnsPublisher,
  type DomainEventPublisher,
} from '@orgflow/events';

import type { WorkerConfig } from '../config/env.js';
import type { Logger } from '../logger.js';

// Mirrors apps/api's own createPublisher exactly (ADR-0008). Extracted to
// its own file, unlike apps/api's inline version, because this worker
// needs it from two entry points (attachment-scan-main.ts and
// attachment-scan-lambda-handler.ts), the same reason resolve-sender.ts
// was already split out for email.
export function resolvePublisher(config: WorkerConfig, logger: Logger): DomainEventPublisher {
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
