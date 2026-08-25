import { createDummyEmailSender, createSesSender, type EmailSender } from '@orgflow/email';

import type { AppConfig } from '../config/env.js';
import type { Logger } from '../logger.js';

// Mirrors workers/src/email/resolve-sender.ts exactly: same construction-
// time choice (ADR-0008), same reasoning, different config shape because
// the two processes validate their own environment independently
// (ADR-0001). Kept as two small functions rather than one shared one,
// since sharing it would mean either process depending on the other's
// config type, which the dependency direction (api and workers are peers)
// does not allow.
export function resolveEmailSender(config: AppConfig, logger: Logger): EmailSender {
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
