import { createDummyFileStore, createS3FileStore, type FileStore } from '@orgflow/storage';

import type { AppConfig } from '../config/env.js';
import type { Logger } from '../logger.js';

// Mirrors email/resolve-sender.ts exactly: same construction-time choice
// (ADR-0008), same reasoning. The scan Lambda and the CDK bucket wiring are
// separate, later pieces of work; this only decides which FileStore the
// attachments routes talk to.
export function resolveFileStore(config: AppConfig, logger: Logger): FileStore {
  if (!config.ORGFLOW_S3_BUCKET) {
    logger.warn('ORGFLOW_S3_BUCKET is not set; attachments go to the dummy file store');
    return createDummyFileStore();
  }

  logger.info({ bucket: config.ORGFLOW_S3_BUCKET }, 'storing attachments in S3');
  return createS3FileStore({
    bucket: config.ORGFLOW_S3_BUCKET,
    region: config.ORGFLOW_AWS_REGION,
    endpoint: config.ORGFLOW_AWS_ENDPOINT,
  });
}
