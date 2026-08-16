import {
  findProcessDefinitionById,
  findProcessDefinitionByKey,
  findProcessVersionById,
  findPublishedProcessDefinitions,
  withTenantTransaction,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import { findProcessDefinitionDocumentById, verifyDocumentIntegrity } from '@orgflow/documents';
import type { ProcessDefinition } from '@orgflow/types';
import { Router } from 'express';
import type { Kysely, Transaction } from 'kysely';
import type { MongoClient } from 'mongodb';

import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf } from '../middleware/require-session.js';

export interface ProcessDefinitionDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
  sessionSecret: string;
}

function toCatalogueEntry(definition: ProcessDefinition) {
  return {
    definitionId: definition.definitionId,
    key: definition.key,
    name: definition.name,
    description: definition.description,
    category: definition.category,
    icon: definition.icon,
    status: definition.status,
    currentVersionId: definition.currentVersionId,
  };
}

export function createProcessDefinitionsRouter(deps: ProcessDefinitionDeps): Router {
  const router = Router();

  router.use('/process-definitions', requireSession(deps.sessionSecret));

  // PRD.md §11.3: list, filterable by status and category. Only published
  // definitions can be started, so the catalogue lists those by default.
  router.get('/process-definitions', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const category = typeof req.query.category === 'string' ? req.query.category : undefined;

      const definitions = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        findPublishedProcessDefinitions(trx),
      );

      const filtered = category
        ? definitions.filter((definition) => definition.category === category)
        : definitions;

      res
        .status(200)
        .json({ data: filtered.map(toCatalogueEntry), nextCursor: null, hasMore: false });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §13.1 routes the catalogue and the form runtime by
  // definitionKey, not by id: /catalogue/:definitionKey and
  // /cases/new/:definitionKey. Registered before the /:definitionId route so
  // the literal segment wins the match, the same ordering /tasks/available
  // relies on.
  router.get('/process-definitions/by-key/:key', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const payload = await loadDefinitionDetail(deps, session.organisationId, (trx) =>
        findProcessDefinitionByKey(trx, req.params.key!),
      );
      res.status(200).json(payload);
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.3: the definition with its current version. The document is
  // what apps/web renders the form from, so it is returned in full.
  router.get('/process-definitions/:definitionId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const payload = await loadDefinitionDetail(deps, session.organisationId, (trx) =>
        findProcessDefinitionById(trx, req.params.definitionId!),
      );
      res.status(200).json(payload);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

// Shared by both detail routes so the two cannot drift: they differ only in
// how the definition is found, never in what is returned or in which
// integrity checks run.
async function loadDefinitionDetail(
  deps: ProcessDefinitionDeps,
  organisationId: string,
  find: (trx: Transaction<Database>) => Promise<ProcessDefinition | null>,
) {
  const result = await withTenantTransaction(deps.db, organisationId, async (trx) => {
    const definition = await find(trx);
    if (!definition?.currentVersionId) {
      return null;
    }
    const version = await findProcessVersionById(trx, definition.currentVersionId);
    return version ? { definition, version } : null;
  });

  // Cross-tenant reads arrive here as null, because RLS hid the row.
  // PRD.md §11.10: 404, never 403, since a 403 confirms it exists.
  if (!result) {
    throw new HttpProblemError(404, 'Not Found', 'No such process definition.');
  }

  const document = await findProcessDefinitionDocumentById(
    deps.mongoClient,
    organisationId,
    result.version.documentId,
  );

  if (!document) {
    throw new HttpProblemError(
      500,
      'Internal Server Error',
      'The published version references a definition document that does not exist.',
    );
  }

  if (!verifyDocumentIntegrity(document, result.version.documentHash)) {
    // PRD.md §2.2 calls document_hash an integrity check, and a check
    // nothing acts on is not one. Serving a document that no longer matches
    // what was published would silently change the form a pinned case
    // executes against.
    throw new HttpProblemError(
      500,
      'Internal Server Error',
      'The definition document does not match the hash recorded when it was published.',
    );
  }

  return {
    definition: toCatalogueEntry(result.definition),
    version: {
      versionId: result.version.versionId,
      versionNumber: result.version.versionNumber,
      status: result.version.status,
      publishedAt: result.version.publishedAt,
    },
    document,
  };
}
