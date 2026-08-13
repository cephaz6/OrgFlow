import type { Database } from '@orgflow/db';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import { pinoHttp } from 'pino-http';

import type { OidcProviderConfig } from './auth/oidc-client.js';
import type { Logger } from './logger.js';
import { correlationId } from './middleware/correlation-id.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { createAuthRouter } from './routes/auth.js';
import { createHealthRouter } from './routes/health.js';

export interface CreateAppDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
  corsOrigin: string;
  logger: Logger;
  sessionSecret: string;
  isLocal: boolean;
  apiBaseUrl: string;
  platformOidc?: OidcProviderConfig | undefined;
}

// Pure factory: every dependency is passed in explicitly, nothing here
// reads process.env, so tests can construct an app without real
// infrastructure for routes that do not need it.
export function createApp(deps: CreateAppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: deps.corsOrigin, credentials: true }));
  app.use(correlationId);
  app.use(pinoHttp({ logger: deps.logger, genReqId: (req) => req.correlationId }));
  app.use(express.json());
  app.use(cookieParser());

  app.use(createHealthRouter({ db: deps.db, mongoClient: deps.mongoClient }));
  app.use(
    createAuthRouter({
      db: deps.db,
      sessionSecret: deps.sessionSecret,
      isLocal: deps.isLocal,
      webUrl: deps.corsOrigin,
      apiBaseUrl: deps.apiBaseUrl,
      platformOidc: deps.platformOidc,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
