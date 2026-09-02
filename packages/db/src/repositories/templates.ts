import type { Transaction } from 'kysely';
import { sql } from 'kysely';

import type { Database } from '../schema.js';
import { generateId } from '../uuid.js';

// PRD.md §9, ADR-0042. Two tables sit behind this repository: `templates`,
// which is tenant-owned and RLS-scoped like everything else, and
// `system_templates`, which belongs to no tenant and is read-only.
//
// No query here filters by organisation_id. That is not an omission: the
// policy on `templates` does it, and CLAUDE.md §3 requires the scoping to
// live below the call site so a route handler cannot forget it. The one
// deliberate widening is the published library, which the migration
// expresses as its own named SELECT policy rather than as a condition any
// query has to remember.

export type TemplateScope = 'system' | 'organisation' | 'published';

export interface BrowsableTemplate {
  templateId: string;
  organisationId: string | null;
  scope: TemplateScope;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
}

export interface TemplateDetail extends BrowsableTemplate {
  documentId: string;
}

// Everything this organisation may browse: its own templates, anything
// another organisation has published to the shared library, and OrgFlow's
// system catalogue. The first two come back from one query because the
// table's policies already decide which rows are visible.
export async function listBrowsableTemplates(
  trx: Transaction<Database>,
): Promise<BrowsableTemplate[]> {
  const [owned, system] = await Promise.all([
    trx
      .selectFrom('templates')
      .select([
        'template_id',
        'organisation_id',
        'scope',
        'key',
        'name',
        'description',
        'category',
        'icon',
      ])
      .orderBy('created_at', 'desc')
      .execute(),
    trx
      .selectFrom('system_templates')
      .select(['template_id', 'key', 'name', 'description', 'category', 'icon'])
      .orderBy('key', 'asc')
      .execute(),
  ]);

  return [
    ...system.map((row) => ({
      templateId: row.template_id,
      organisationId: null,
      scope: 'system' as const,
      key: row.key,
      name: row.name,
      description: row.description,
      category: row.category,
      icon: row.icon,
    })),
    ...owned.map((row) => ({
      templateId: row.template_id,
      organisationId: row.organisation_id,
      scope: row.scope as TemplateScope,
      key: row.key,
      name: row.name,
      description: row.description,
      category: row.category,
      icon: row.icon,
    })),
  ];
}

// Null rather than a throw when the row is invisible: PRD.md and
// CLAUDE.md §3 both require a cross-tenant read to look like absence, and
// the route turns this into a 404.
export async function findTemplateById(
  trx: Transaction<Database>,
  templateId: string,
): Promise<TemplateDetail | null> {
  const row = await trx
    .selectFrom('templates')
    .select([
      'template_id',
      'organisation_id',
      'scope',
      'key',
      'name',
      'description',
      'category',
      'icon',
      'document_id',
    ])
    .where('template_id', '=', templateId)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return {
    templateId: row.template_id,
    organisationId: row.organisation_id,
    scope: row.scope as TemplateScope,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon,
    documentId: row.document_id,
  };
}

export async function findSystemTemplateById(
  trx: Transaction<Database>,
  templateId: string,
): Promise<TemplateDetail | null> {
  const row = await trx
    .selectFrom('system_templates')
    .select(['template_id', 'key', 'name', 'description', 'category', 'icon', 'document_id'])
    .where('template_id', '=', templateId)
    .executeTakeFirst();

  if (!row) {
    return null;
  }

  return {
    templateId: row.template_id,
    organisationId: null,
    scope: 'system',
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon,
    documentId: row.document_id,
  };
}

export interface CreateTemplateInput {
  organisationId: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  documentId: string;
  createdByUserId: string;
}

export async function createTemplate(
  trx: Transaction<Database>,
  input: CreateTemplateInput,
): Promise<string> {
  const templateId = generateId();

  await trx
    .insertInto('templates')
    .values({
      template_id: templateId,
      organisation_id: input.organisationId,
      key: input.key,
      name: input.name,
      description: input.description,
      category: input.category,
      icon: input.icon,
      document_id: input.documentId,
      created_by_user_id: input.createdByUserId,
    })
    .execute();

  return templateId;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
}

// Returns whether a row was actually updated. The UPDATE is governed by
// tenant_isolation alone (the published-library policy is FOR SELECT), so
// another organisation's published template matches zero rows here rather
// than being quietly rewritten, and the caller reports 404.
export async function updateTemplate(
  trx: Transaction<Database>,
  templateId: string,
  patch: UpdateTemplateInput,
): Promise<boolean> {
  const result = await trx
    .updateTable('templates')
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.icon !== undefined ? { icon: patch.icon } : {}),
      updated_at: sql`now()`,
    })
    .where('template_id', '=', templateId)
    .executeTakeFirst();

  return Number(result.numUpdatedRows) > 0;
}

// PRD.md §9.1's opt-in: sharing is a scope change on a row the
// organisation already owns, not a copy into a separate library.
export async function setTemplateScope(
  trx: Transaction<Database>,
  templateId: string,
  scope: 'organisation' | 'published',
): Promise<boolean> {
  const result = await trx
    .updateTable('templates')
    .set({ scope, updated_at: sql`now()` })
    .where('template_id', '=', templateId)
    .executeTakeFirst();

  return Number(result.numUpdatedRows) > 0;
}

export async function deleteTemplate(
  trx: Transaction<Database>,
  templateId: string,
): Promise<boolean> {
  const result = await trx
    .deleteFrom('templates')
    .where('template_id', '=', templateId)
    .executeTakeFirst();

  return Number(result.numDeletedRows) > 0;
}
