import type { Database } from '@orgflow/db';
import type { DomainEventPublisher } from '@orgflow/events';
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
import { createCasesRouter } from './routes/cases.js';
import { createDelegationsRouter } from './routes/delegations.js';
import { createHealthRouter } from './routes/health.js';
import { createProcessDefinitionsRouter } from './routes/process-definitions.js';
import { createMembersRouter } from './routes/members.js';
import { createReportsRouter } from './routes/reports.js';
import { createTasksRouter } from './routes/tasks.js';

export interface CreateAppDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
  publisher: DomainEventPublisher;
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

  // /health and /ready are infrastructure probes, not API resources: they
  // stay unversioned so a load balancer or container orchestrator never
  // has to track the API version to check liveness.
  app.use(createHealthRouter({ db: deps.db, mongoClient: deps.mongoClient }));

  // PRD.md §11: every API route lives under /api/v1.
  app.use(
    '/api/v1',
    createAuthRouter({
      db: deps.db,
      mongoClient: deps.mongoClient,
      sessionSecret: deps.sessionSecret,
      isLocal: deps.isLocal,
      webUrl: deps.corsOrigin,
      apiBaseUrl: deps.apiBaseUrl,
      platformOidc: deps.platformOidc,
    }),
  );

  app.use(
    '/api/v1',
    createProcessDefinitionsRouter({
      db: deps.db,
      mongoClient: deps.mongoClient,
      sessionSecret: deps.sessionSecret,
    }),
  );

  app.use(
    '/api/v1',
    createCasesRouter({
      db: deps.db,
      mongoClient: deps.mongoClient,
      publisher: deps.publisher,
      sessionSecret: deps.sessionSecret,
      logger: deps.logger,
    }),
  );

  app.use(
    '/api/v1',
    createTasksRouter({
      db: deps.db,
      mongoClient: deps.mongoClient,
      publisher: deps.publisher,
      sessionSecret: deps.sessionSecret,
      logger: deps.logger,
    }),
  );

  app.use(
    '/api/v1',
    createDelegationsRouter({
      db: deps.db,
      sessionSecret: deps.sessionSecret,
    }),
  );

  app.use(
    '/api/v1',
    createReportsRouter({
      db: deps.db,
      sessionSecret: deps.sessionSecret,
    }),
  );

  app.use(
    '/api/v1',
    createMembersRouter({
      db: deps.db,
      sessionSecret: deps.sessionSecret,
    }),
  );

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
