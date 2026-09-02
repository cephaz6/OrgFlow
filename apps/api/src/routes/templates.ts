import { cloneTemplate } from '@orgflow/core';
import {
  createProcessDefinition,
  createProcessVersion,
  createTemplate,
  deleteTemplate,
  findProcessDefinitionsForOrganisation,
  findSystemTemplateById,
  findTemplateById,
  generateId,
  listBrowsableTemplates,
  setTemplateScope,
  updateTemplate,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import {
  findLatestProcessDefinitionDocument,
  findSharedTemplateDocument,
  insertProcessDefinitionDocument,
  insertTemplateDocument,
  type StoredTemplateDocument,
} from '@orgflow/documents';
import type { TemplateBlueprint } from '@orgflow/types';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import { z } from 'zod';

import { parseBody } from '../lib/parse-body.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf } from '../middleware/require-session.js';
import { canCreateProcessDefinitions } from '../processes/permissions.js';

export interface TemplatesDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
  sessionSecret: string;
}

const scopeQuerySchema = z.enum(['system', 'organisation', 'published']).optional();

const saveSchema = z.object({
  definitionId: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  category: z.string().max(200).nullable().optional(),
});

const patchSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).nullable().optional(),
    category: z.string().max(200).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Provide at least one field to update.',
  });

const publishSchema = z.object({
  published: z.boolean(),
});

// A template id may name a row in either table, and the caller does not
// know which. Tenant-owned first, since RLS has already decided whether
// this organisation may see it, then the system catalogue.
async function findEitherTemplate(trx: Parameters<typeof findTemplateById>[0], templateId: string) {
  return (await findTemplateById(trx, templateId)) ?? findSystemTemplateById(trx, templateId);
}

function blueprintOf(document: StoredTemplateDocument | null, templateId: string) {
  if (!document) {
    // The registry row exists but its blueprint does not, which means the
    // two stores have diverged. Worth a 500 rather than a 404: the row the
    // caller asked for is genuinely there, and pretending otherwise would
    // hide a real inconsistency.
    throw new HttpProblemError(
      500,
      'Internal Server Error',
      `The blueprint for template ${templateId} is missing.`,
    );
  }
  return document.blueprint;
}

export function createTemplatesRouter(deps: TemplatesDeps): Router {
  const router = Router();

  router.use('/templates', requireSession(deps.sessionSecret));

  // PRD.md §11.4. Browsing is open to any signed-in member: a template
  // carries no case data, and the catalogue is what a would-be process
  // owner looks at before asking for the role.
  router.get('/templates', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const scope = scopeQuerySchema.parse(req.query.scope);

      const templates = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        listBrowsableTemplates(trx),
      );

      const filtered = scope ? templates.filter((row) => row.scope === scope) : templates;
      res.status(200).json({ data: filtered });
    } catch (err) {
      next(err);
    }
  });

  router.get('/templates/:templateId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const templateId = req.params.templateId!;

      const template = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        findEitherTemplate(trx, templateId),
      );

      if (!template) {
        throw new HttpProblemError(404, 'Not Found', 'No such template.');
      }

      const document = await findSharedTemplateDocument(deps.mongoClient, templateId);

      res.status(200).json({
        template: {
          templateId: template.templateId,
          organisationId: template.organisationId,
          scope: template.scope,
          key: template.key,
          name: template.name,
          description: template.description,
          category: template.category,
          icon: template.icon,
        },
        blueprint: blueprintOf(document, templateId),
      });
    } catch (err) {
      next(err);
    }
  });

  // "Save this process as a template", from a definition the caller can
  // already manage. The blueprint is the definition's current document
  // minus the identifiers that tie it to this organisation.
  router.post('/templates', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const body = parseBody(saveSchema, req.body);
      const now = new Date().toISOString();

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await canCreateProcessDefinitions(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only a process owner or administrator can save a template.',
          );
        }

        const definitions = await findProcessDefinitionsForOrganisation(trx);
        const definition = definitions.find(
          (candidate) => candidate.definitionId === body.definitionId,
        );
        if (!definition || !definition.currentVersionId) {
          throw new HttpProblemError(
            404,
            'Not Found',
            'No such process, or it has never been published.',
          );
        }

        const stored = await findLatestProcessDefinitionDocument(
          deps.mongoClient,
          session.organisationId,
          definition.definitionId,
        );
        if (!stored) {
          throw new HttpProblemError(404, 'Not Found', 'That process has no document.');
        }

        // Deliberately dropped: a blueprint carrying the originating
        // organisation, definition or version would make every clone a
        // partial copy of somebody else's identifiers rather than a hard
        // copy of a shape. _id and documentHash go too, since both describe
        // the stored document rather than the process it holds.
        const {
          _id: _mongoId,
          documentHash: _documentHash,
          organisationId: _organisationId,
          definitionId: _definitionId,
          versionNumber: _versionNumber,
          createdByUserId: _createdByUserId,
          createdAt: _createdAt,
          ...blueprint
        } = stored;

        // Document first, registry row second, so the row never points at a
        // blueprint that does not exist. The reverse order can strand a
        // template that clones to nothing; this order can at worst strand an
        // unreferenced document, which is inert. Same ordering as
        // process-definitions.ts, where the version row lands after its
        // document.
        const templateId = generateId();
        const documentId = await insertTemplateDocument(deps.mongoClient, {
          organisationId: session.organisationId,
          templateId,
          blueprint: blueprint as TemplateBlueprint,
          now,
        });

        await createTemplate(trx, {
          templateId,
          organisationId: session.organisationId,
          key: definition.key,
          name: body.name,
          description: body.description ?? null,
          category: body.category ?? null,
          icon: definition.icon,
          documentId,
          createdByUserId: session.userId,
        });

        return { templateId, name: body.name };
      });

      res.status(201).json({ template: result });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §9.2. Produces a definition and a draft version in the caller's
  // organisation, plus the warnings ADR-0043 keeps out of the document.
  router.post('/templates/:templateId/clone', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const templateId = req.params.templateId!;
      const now = new Date().toISOString();

      const document = await findSharedTemplateDocument(deps.mongoClient, templateId);

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await canCreateProcessDefinitions(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only a process owner or administrator can clone a template.',
          );
        }

        // Read through the registry rather than trusting the Mongo lookup:
        // the blueprint collection has no tenant policy of its own, so the
        // registry is what decides whether this organisation may see this
        // template at all.
        const template = await findEitherTemplate(trx, templateId);
        if (!template) {
          throw new HttpProblemError(404, 'Not Found', 'No such template.');
        }

        const blueprint = blueprintOf(document, templateId);
        const definitions = await findProcessDefinitionsForOrganisation(trx);

        const definitionId = crypto.randomUUID();
        const { document: cloned, warnings } = cloneTemplate({
          blueprint,
          organisationId: session.organisationId,
          definitionId,
          existingKeys: definitions.map((candidate) => candidate.key),
          createdByUserId: session.userId,
          now,
        });

        const definition = await createProcessDefinition(trx, {
          organisationId: session.organisationId,
          key: cloned.key,
          name: cloned.name,
          description: cloned.description ?? null,
          category: cloned.category ?? null,
          icon: cloned.icon ?? null,
          referencePrefix: cloned.key.slice(0, 3).toUpperCase(),
          retentionDays: cloned.retentionDays ?? null,
          owningGroupId: null,
          createdByUserId: session.userId,
        });

        const stored = await insertProcessDefinitionDocument(deps.mongoClient, {
          ...cloned,
          definitionId: definition.definitionId,
        });

        const version = await createProcessVersion(trx, {
          organisationId: session.organisationId,
          definitionId: definition.definitionId,
          versionNumber: 1,
          documentId: stored.documentId,
          documentHash: stored.documentHash,
        });

        return { definition, version, warnings };
      });

      res.status(201).json({
        definitionId: result.definition.definitionId,
        key: result.definition.key,
        name: result.definition.name,
        versionId: result.version.versionId,
        // ADR-0043: what a human still has to configure, named rather than
        // counted, so the builder can say which step pointed at what.
        warnings: result.warnings,
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/templates/:templateId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const templateId = req.params.templateId!;
      const body = parseBody(patchSchema, req.body);

      await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await canCreateProcessDefinitions(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only a process owner or administrator can edit a template.',
          );
        }

        // No scope check needed: UPDATE is governed by tenant_isolation
        // alone, so a system template (a different table) and another
        // organisation's published one both match zero rows here.
        const updated = await updateTemplate(trx, templateId, {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.category !== undefined ? { category: body.category } : {}),
        });

        if (!updated) {
          throw new HttpProblemError(404, 'Not Found', 'No such template.');
        }
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §11.4's publish-to-library, as a toggle rather than a one-way
  // door: an organisation that shared a template by mistake can withdraw
  // it, and anything already cloned from it is unaffected either way,
  // because a clone keeps no reference back (PRD.md §9.2).
  router.post('/templates/:templateId/publish-to-library', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const templateId = req.params.templateId!;
      const body = parseBody(publishSchema, req.body);

      await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await canCreateProcessDefinitions(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only a process owner or administrator can share a template.',
          );
        }

        const changed = await setTemplateScope(
          trx,
          templateId,
          body.published ? 'published' : 'organisation',
        );
        if (!changed) {
          throw new HttpProblemError(404, 'Not Found', 'No such template.');
        }
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.delete('/templates/:templateId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const templateId = req.params.templateId!;

      await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await canCreateProcessDefinitions(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Only a process owner or administrator can delete a template.',
          );
        }

        const deleted = await deleteTemplate(trx, templateId);
        if (!deleted) {
          throw new HttpProblemError(404, 'Not Found', 'No such template.');
        }
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
