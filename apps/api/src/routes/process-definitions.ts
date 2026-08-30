import {
  clampPageSize,
  createProcessDefinition,
  createProcessVersion,
  decodeCompositeCursor,
  encodeCompositeCursor,
  findDraftProcessVersion,
  findLatestVersionNumber,
  findProcessDefinitionById,
  findProcessDefinitionByKey,
  findProcessDefinitionsForOrganisation,
  findProcessVersionById,
  findPublishedProcessDefinitions,
  publishProcessVersion,
  updateProcessDefinitionMetadata,
  updateProcessVersionDocumentHash,
  withTenantTransaction,
} from '@orgflow/db';
import type { Database } from '@orgflow/db';
import {
  findProcessDefinitionDocumentById,
  insertProcessDefinitionDocument,
  updateProcessDefinitionDocument,
  verifyDocumentIntegrity,
} from '@orgflow/documents';
import type { ProcessDefinition, ProcessDefinitionDocument } from '@orgflow/types';
import { Router } from 'express';
import type { Kysely, Transaction } from 'kysely';
import type { MongoClient } from 'mongodb';
import { z } from 'zod';

import { slugify } from '../lib/slugify.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf, type RequestSession } from '../middleware/require-session.js';
import {
  createProcessDefinitionBodySchema,
  definitionDocumentBodySchema,
  publishDraftBodySchema,
  type DefinitionDocumentBody,
} from '../processes/document-schema.js';
import {
  canCreateProcessDefinitions,
  canManageProcessDefinition,
} from '../processes/permissions.js';

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
    createdAt: definition.createdAt,
  };
}

// PRD.md §11.10: cursor-based pagination, ?limit&cursor, plus a free-text
// name search shared by the catalogue and the manage list.
const listQuerySchema = z.object({
  query: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional(),
});

const catalogueQuerySchema = listQuerySchema.extend({
  category: z.string().min(1).optional(),
});

// Turns a Zod failure into the RFC 7807 shape PRD.md §11.10 specifies,
// matching the pattern every other route file uses.
function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
      .join('; ');
    throw new HttpProblemError(400, 'Bad Request', detail);
  }
  return parsed.data;
}

// The slug a new definition gets. Tries the plain slug first, then
// '-2', '-3', ... so two definitions named the same thing do not require
// the creator to think of a different name themselves.
async function allocateDefinitionKey(trx: Transaction<Database>, name: string): Promise<string> {
  const base = slugify(name) || 'process';
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (!(await findProcessDefinitionByKey(trx, candidate))) {
      return candidate;
    }
  }
  throw new HttpProblemError(409, 'Conflict', 'Could not allocate a unique key for this name.');
}

// The bootstrap document a newly created definition starts from: an empty
// form and a workflow that goes straight to $completed. Both PRD.md's
// engine (packages/core/src/engine/advance.ts) and definitionDocumentBodySchema
// accept startStepKey pointing directly at a terminal key, so this is
// already a structurally valid, publishable document, just a trivial one:
// the form builder can fill it in, and the workflow builder (not built yet)
// will later give startStepKey somewhere real to point.
function bootstrapDocument(input: {
  organisationId: string;
  definitionId: string;
  versionNumber: number;
  key: string;
  name: string;
  description?: string;
  category?: string;
  icon?: string;
  retentionDays?: number;
  createdByUserId: string;
  now: string;
}): ProcessDefinitionDocument {
  return {
    organisationId: input.organisationId,
    definitionId: input.definitionId,
    versionNumber: input.versionNumber,
    key: input.key,
    name: input.name,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
    form: { titleFieldKey: '', sections: [] },
    workflow: { startStepKey: '$completed', steps: [] },
    ...(input.retentionDays !== undefined ? { retentionDays: input.retentionDays } : {}),
    createdByUserId: input.createdByUserId,
    createdAt: input.now,
  };
}

// The document body a PATCH sends, folded onto the definition it belongs
// to. Everything server-controlled (organisationId, definitionId,
// versionNumber, createdByUserId, createdAt) comes from the existing
// definition/version, never from the request, so a tenant cannot forge
// which organisation or definition a document belongs to.
function documentFromBody(
  body: DefinitionDocumentBody,
  definition: ProcessDefinition,
  versionNumber: number,
): ProcessDefinitionDocument {
  const draft = {
    organisationId: definition.organisationId,
    definitionId: definition.definitionId,
    versionNumber,
    key: definition.key,
    name: body.name,
    description: body.description,
    category: body.category,
    icon: body.icon,
    form: body.form,
    workflow: body.workflow,
    notifications: body.notifications,
    retentionDays: body.retentionDays,
    createdByUserId: definition.createdByUserId,
    createdAt: definition.createdAt,
  };
  // definitionDocumentBodySchema mirrors ProcessDefinitionDocument field for
  // field, so the shapes already match structurally; the round trip only
  // erases keys zod left set to literal undefined, since JSON, unlike
  // TypeScript, has no way to hold an explicit-undefined key distinct from
  // an omitted one, and that is exactly the shape this document is about to
  // be written to Mongo as.
  return JSON.parse(JSON.stringify(draft)) as ProcessDefinitionDocument;
}

function toManagementEntry(definition: ProcessDefinition) {
  return {
    ...toCatalogueEntry(definition),
    owningGroupId: definition.owningGroupId,
    createdByUserId: definition.createdByUserId,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  };
}

// A definition within this tenant that the caller is permitted to manage.
// Cross-tenant rows arrive here as null (RLS hid the row) and are
// indistinguishable from a definition that does not exist, so both become
// 404, never 403, per PRD.md §11.10.
async function requireManageableDefinition(
  trx: Transaction<Database>,
  session: RequestSession,
  definitionId: string,
): Promise<ProcessDefinition> {
  const definition = await findProcessDefinitionById(trx, definitionId);
  if (!definition) {
    throw new HttpProblemError(404, 'Not Found', 'No such process definition.');
  }
  if (!(await canManageProcessDefinition(trx, session, definition))) {
    throw new HttpProblemError(404, 'Not Found', 'No such process definition.');
  }
  return definition;
}

export function createProcessDefinitionsRouter(deps: ProcessDefinitionDeps): Router {
  const router = Router();

  router.use('/process-definitions', requireSession(deps.sessionSecret));

  // PRD.md §11.3: list, filterable by status and category. Only published
  // definitions can be started, so the catalogue lists those by default.
  router.get('/process-definitions', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const filter = parseBody(catalogueQuerySchema, req.query as Record<string, unknown>);

      const page = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        findPublishedProcessDefinitions(trx, filter),
      );

      res.status(200).json({
        data: page.definitions.map(toCatalogueEntry),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §13.1's "manage processes" list: every status, not just
  // published, filtered to what the caller may manage (their own
  // definitions, or everything for admin/owner). Registered before the
  // /:definitionId route so the literal segment wins the match, the same
  // ordering /tasks/available relies on.
  router.get('/process-definitions/manage', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const filter = parseBody(listQuerySchema, req.query as Record<string, unknown>);

      const permitted = await withTenantTransaction(
        deps.db,
        session.organisationId,
        async (trx) => {
          const all = await findProcessDefinitionsForOrganisation(trx, {
            ...(filter.query !== undefined ? { query: filter.query } : {}),
          });
          const flags = await Promise.all(
            all.map((definition) => canManageProcessDefinition(trx, session, definition)),
          );
          return all.filter((_definition, index) => flags[index]);
        },
      );

      // Pagination happens here, over the array, rather than in SQL: the
      // permission filter above is an async per-row check that cannot be
      // expressed as a WHERE clause, so it has to run first. `permitted`
      // is already a total order (updated_at desc, definition_id desc, per
      // the repository's own ORDER BY), which is what makes "everything
      // strictly after the cursor's position" the same set whether found
      // by index or, as here, by comparing each row against the cursor.
      const cursor = filter.cursor
        ? decodeCompositeCursor<{ updatedAt: string; id: string }>(filter.cursor, [
            'updatedAt',
            'id',
          ])
        : null;
      const afterCursor = cursor
        ? permitted.filter((definition) =>
            definition.updatedAt === cursor.updatedAt
              ? definition.definitionId < cursor.id
              : definition.updatedAt < cursor.updatedAt,
          )
        : permitted;

      const limit = clampPageSize(filter.limit);
      const hasMore = afterCursor.length > limit;
      const page = hasMore ? afterCursor.slice(0, limit) : afterCursor;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCompositeCursor({ updatedAt: last.updatedAt, id: last.definitionId })
          : null;

      res.status(200).json({ data: page.map(toManagementEntry), nextCursor, hasMore });
    } catch (err) {
      next(err);
    }
  });

  // The form builder's create step: a definition, a draft version and a
  // bootstrap document, all in one call, so the builder always has
  // somewhere to save its first edit rather than juggling a two-step
  // "create the shell, then create the draft" flow.
  router.post('/process-definitions', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const body = parseBody(createProcessDefinitionBodySchema, req.body);
      const now = new Date().toISOString();

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await canCreateProcessDefinitions(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only a process owner or administrator can create a process.',
          );
        }

        const key = await allocateDefinitionKey(trx, body.name);

        const definition = await createProcessDefinition(trx, {
          organisationId: session.organisationId,
          key,
          name: body.name,
          description: body.description ?? null,
          category: body.category ?? null,
          icon: body.icon ?? null,
          referencePrefix: body.referencePrefix,
          retentionDays: body.retentionDays ?? null,
          owningGroupId: body.owningGroupId ?? null,
          createdByUserId: session.userId,
        });

        const document = bootstrapDocument({
          organisationId: session.organisationId,
          definitionId: definition.definitionId,
          versionNumber: 1,
          key,
          name: body.name,
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
          ...(body.icon !== undefined ? { icon: body.icon } : {}),
          ...(body.retentionDays !== undefined ? { retentionDays: body.retentionDays } : {}),
          createdByUserId: session.userId,
          now,
        });

        const stored = await insertProcessDefinitionDocument(deps.mongoClient, document);

        const version = await createProcessVersion(trx, {
          organisationId: session.organisationId,
          definitionId: definition.definitionId,
          versionNumber: 1,
          documentId: stored.documentId,
          documentHash: stored.documentHash,
        });

        return { definition, version, document: stored.document };
      });

      res.status(201).json({
        definition: toManagementEntry(result.definition),
        version: {
          versionId: result.version.versionId,
          versionNumber: result.version.versionNumber,
          status: result.version.status,
        },
        document: result.document,
      });
    } catch (err) {
      next(err);
    }
  });

  // The builder's load: the current draft (or, if the definition has never
  // been published, its only version) plus the document to edit.
  router.get('/process-definitions/:definitionId/draft', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const definitionId = req.params.definitionId!;

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const definition = await requireManageableDefinition(trx, session, definitionId);
        const draft = await findDraftProcessVersion(trx, definitionId);
        if (!draft) {
          throw new HttpProblemError(
            409,
            'Conflict',
            'This process has no open draft. Publish creates one automatically the next time it is edited.',
          );
        }
        return { definition, draft };
      });

      const document = await findProcessDefinitionDocumentById(
        deps.mongoClient,
        session.organisationId,
        result.draft.documentId,
      );
      if (!document) {
        throw new HttpProblemError(
          500,
          'Internal Server Error',
          'The draft version references a definition document that does not exist.',
        );
      }

      res.status(200).json({
        definition: toManagementEntry(result.definition),
        version: {
          versionId: result.draft.versionId,
          versionNumber: result.draft.versionNumber,
          status: result.draft.status,
        },
        document,
      });
    } catch (err) {
      next(err);
    }
  });

  // The builder's save. Edits the open draft in place if there is one
  // (packages/documents/src/process-definitions.ts's
  // updateProcessDefinitionDocument, the deliberate, narrow exception to
  // document immutability: a draft can never be pinned to by a case). If
  // the definition was published and has no open draft, this opens a new
  // one, seeded from the body the client already holds.
  router.patch('/process-definitions/:definitionId/draft', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const definitionId = req.params.definitionId!;
      const body = parseBody(definitionDocumentBodySchema, req.body);

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        const definition = await requireManageableDefinition(trx, session, definitionId);

        await updateProcessDefinitionMetadata(trx, definitionId, {
          name: body.name,
          description: body.description ?? null,
          category: body.category ?? null,
          icon: body.icon ?? null,
          // Omitted (not merely absent-with-a-value) means "leave it as is":
          // the builder's ordinary save never sends this field at all, so
          // treating a missing key the same as an explicit null would wipe
          // out the owning group on every edit that is not the group
          // picker's own change.
          ...(body.owningGroupId !== undefined ? { owningGroupId: body.owningGroupId } : {}),
        });

        const existingDraft = await findDraftProcessVersion(trx, definitionId);

        if (existingDraft) {
          const document = documentFromBody(body, definition, existingDraft.versionNumber);
          const stored = await updateProcessDefinitionDocument(
            deps.mongoClient,
            session.organisationId,
            existingDraft.documentId,
            document,
          );
          await updateProcessVersionDocumentHash(trx, existingDraft.versionId, stored.documentHash);
          return {
            versionId: existingDraft.versionId,
            versionNumber: existingDraft.versionNumber,
            document: stored.document,
          };
        }

        const nextVersionNumber = (await findLatestVersionNumber(trx, definitionId)) + 1;
        const document = documentFromBody(body, definition, nextVersionNumber);
        const stored = await insertProcessDefinitionDocument(deps.mongoClient, document);
        const version = await createProcessVersion(trx, {
          organisationId: session.organisationId,
          definitionId,
          versionNumber: nextVersionNumber,
          documentId: stored.documentId,
          documentHash: stored.documentHash,
        });
        return {
          versionId: version.versionId,
          versionNumber: version.versionNumber,
          document: stored.document,
        };
      });

      res.status(200).json({
        version: {
          versionId: result.versionId,
          versionNumber: result.versionNumber,
          status: 'draft',
        },
        document: result.document,
      });
    } catch (err) {
      next(err);
    }
  });

  // Publishes the open draft: PRD.md §5.2/§11.2's version pinning means
  // this is the point of no return for this document's content. From here
  // it is read-only, and the next edit opens a new draft instead of
  // mutating this one.
  router.post('/process-definitions/:definitionId/draft/publish', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const definitionId = req.params.definitionId!;
      parseBody(publishDraftBodySchema, req.body);

      const version = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        await requireManageableDefinition(trx, session, definitionId);

        const draft = await findDraftProcessVersion(trx, definitionId);
        if (!draft) {
          throw new HttpProblemError(409, 'Conflict', 'This process has no open draft to publish.');
        }

        return publishProcessVersion(trx, draft.versionId, session.userId);
      });

      res.status(200).json({
        version: {
          versionId: version.versionId,
          versionNumber: version.versionNumber,
          status: version.status,
          publishedAt: version.publishedAt,
        },
      });
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
