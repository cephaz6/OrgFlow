import { createDummyFileStore, createS3FileStore, type FileStore } from '@orgflow/storage';

import type { WorkerConfig } from '../config/env.js';
import type { Logger } from '../logger.js';

// Mirrors apps/api's own resolveFileStore exactly (ADR-0008): the same
// construction-time choice, same reasoning. This worker needs a FileStore
// to read the bytes it scans and to move an infected object to quarantine.
export function resolveFileStore(config: WorkerConfig, logger: Logger): FileStore {
  if (!config.ORGFLOW_S3_BUCKET) {
    logger.warn('ORGFLOW_S3_BUCKET is not set; attachments go to the dummy file store');
    return createDummyFileStore();
  }

  logger.info({ bucket: config.ORGFLOW_S3_BUCKET }, 'reading and quarantining attachments in S3');
  return createS3FileStore({
    bucket: config.ORGFLOW_S3_BUCKET,
    region: config.ORGFLOW_AWS_REGION,
    endpoint: config.ORGFLOW_AWS_ENDPOINT,
  });
}
