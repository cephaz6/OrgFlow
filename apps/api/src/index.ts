import { createDb } from '@orgflow/db';
import { createMongoClient } from '@orgflow/documents';

import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createLogger } from './logger.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.ORGFLOW_LOG_LEVEL);

  try {
    const db = createDb({ connectionString: config.ORGFLOW_DATABASE_URL });
    const mongoClient = await createMongoClient({ uri: config.ORGFLOW_MONGODB_URI });

    const app = createApp({
      db,
      mongoClient,
      corsOrigin: config.ORGFLOW_WEB_URL,
      logger,
    });

    app.listen(config.ORGFLOW_API_PORT, () => {
      logger.info({ port: config.ORGFLOW_API_PORT }, 'apps/api listening');
    });
  } catch (err) {
    logger.fatal({ err }, 'failed to start apps/api');
    process.exit(1);
  }
}

void main();
