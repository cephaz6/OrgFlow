import type { WorkerConfig } from '../config/env.js';
import type { Logger } from '../logger.js';
import { createDummyEmailSender } from './dummy-sender.js';
import type { EmailSender } from './sender.js';
import { createSesSender } from './ses-sender.js';

// ADR-0008 and the 3pservice pattern: the transport is a construction-time
// choice behind one interface. Shared by main.ts (the local poll loop) and
// lambda-handler.ts (the deployed consumer), so the two entry points can
// never pick this differently. Which one was built is logged rather than
// left implicit, because "no email arrived" and "email went to a dummy"
// look identical from the outside otherwise.
export function resolveEmailSender(config: WorkerConfig, logger: Logger): EmailSender {
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
