import type {
  ProcessDefinition,
  ProcessDefinitionStatus,
  ProcessVersion,
  ProcessVersionStatus,
} from '@orgflow/types';
import { sql, type Selectable, type Transaction } from 'kysely';

import { clampPageSize, decodeCompositeCursor, encodeCompositeCursor } from '../pagination.js';
import type { Database, ProcessDefinitionsTable, ProcessVersionsTable } from '../schema.js';
import { generateId } from '../uuid.js';

function toDefinitionDomain(row: Selectable<ProcessDefinitionsTable>): ProcessDefinition {
  return {
    definitionId: row.definition_id,
    organisationId: row.organisation_id,
    key: row.key,
    name: row.name,
    description: row.description,
    category: row.category,
    icon: row.icon,
    status: row.status as ProcessDefinitionStatus,
    currentVersionId: row.current_version_id,
    referencePrefix: row.reference_prefix,
    // BIGINT arrives as a string from node-postgres; the counter is a
    // per-definition case count, far below Number.MAX_SAFE_INTEGER.
    referenceCounter: Number(row.reference_counter),
    retentionDays: row.retention_days,
    owningGroupId: row.owning_group_id,
    createdByUserId: row.created_by_user_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toVersionDomain(row: Selectable<ProcessVersionsTable>): ProcessVersion {
  return {
    versionId: row.version_id,
    organisationId: row.organisation_id,
    definitionId: row.definition_id,
    versionNumber: row.version_number,
    documentId: row.document_id,
    documentHash: row.document_hash,
    status: row.status as ProcessVersionStatus,
    changeNote: row.change_note,
    publishedByUserId: row.published_by_user_id,
    publishedAt: row.published_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export interface CreateProcessDefinitionInput {
  organisationId: string;
  key: string;
  name: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
  referencePrefix: string;
  retentionDays?: number | null;
  owningGroupId?: string | null;
  createdByUserId: string;
}

export async function createProcessDefinition(
  trx: Transaction<Database>,
  input: CreateProcessDefinitionInput,
): Promise<ProcessDefinition> {
  const row = await trx
    .insertInto('process_definitions')
    .values({
      definition_id: generateId(),
      organisation_id: input.organisationId,
      key: input.key,
      name: input.name,
      description: input.description ?? null,
      category: input.category ?? null,
      icon: input.icon ?? null,
      reference_prefix: input.referencePrefix,
      retention_days: input.retentionDays ?? null,
      owning_group_id: input.owningGroupId ?? null,
      created_by_user_id: input.createdByUserId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDefinitionDomain(row);
}

export async function findProcessDefinitionByKey(
  trx: Transaction<Database>,
  key: string,
): Promise<ProcessDefinition | null> {
  const row = await trx
    .selectFrom('process_definitions')
    .selectAll()
    .where('key', '=', key)
    .executeTakeFirst();

  return row ? toDefinitionDomain(row) : null;
}

export async function findProcessDefinitionById(
  trx: Transaction<Database>,
  definitionId: string,
): Promise<ProcessDefinition | null> {
  const row = await trx
    .selectFrom('process_definitions')
    .selectAll()
    .where('definition_id', '=', definitionId)
    .executeTakeFirst();

  return row ? toDefinitionDomain(row) : null;
}

export interface FindPublishedProcessDefinitionsFilter {
  category?: string | undefined;
  // Free text over name. Absent means no filter rather than an empty
  // search, which would otherwise match nothing.
  query?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface ProcessDefinitionPage {
  definitions: ProcessDefinition[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface CatalogueCursor extends Record<string, string> {
  name: string;
  id: string;
}

// A catalogue is browsed alphabetically, not by when a template happened
// to be published, so this is ordered and cursor-paginated by name, the
// same composite (name, id) cursor findMemberDirectoryForCurrentTenant
// uses and for the same reason: name alone is not unique enough to be a
// cursor on its own.
export async function findPublishedProcessDefinitions(
  trx: Transaction<Database>,
  filter: FindPublishedProcessDefinitionsFilter = {},
): Promise<ProcessDefinitionPage> {
  let query = trx.selectFrom('process_definitions').selectAll().where('status', '=', 'published');

  if (filter.category) {
    query = query.where('category', '=', filter.category);
  }

  if (filter.query) {
    query = query.where('name', 'ilike', `%${filter.query}%`);
  }

  const cursor = filter.cursor
    ? decodeCompositeCursor<CatalogueCursor>(filter.cursor, ['name', 'id'])
    : null;
  if (cursor) {
    query = query.where(sql<boolean>`(name, definition_id) > (${cursor.name}, ${cursor.id})`);
  }

  const limit = clampPageSize(filter.limit);

  const rows = await query
    .orderBy('name', 'asc')
    .orderBy('definition_id', 'asc')
    .limit(limit + 1)
    .execute();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    definitions: page.map(toDefinitionDomain),
    nextCursor:
      hasMore && last
        ? encodeCompositeCursor<CatalogueCursor>({ name: last.name, id: last.definition_id })
        : null,
    hasMore,
  };
}

export interface FindProcessDefinitionsForOrganisationFilter {
  // Free text over name. Absent means no filter rather than an empty
  // search, which would otherwise match nothing.
  query?: string | undefined;
}

// Every status, for the builder's "manage processes" list (PRD.md §13.1's
// /processes route). findPublishedProcessDefinitions above is deliberately
// narrower: the catalogue a requester browses must never show a draft, but
// a process owner managing their own definitions needs to see one.
//
// Unpaginated here deliberately: the route filters this result by an async
// per-row permission check (canManageProcessDefinition) that cannot be
// expressed as a WHERE clause, so pagination has to happen after that
// filter, in the route, over whatever survives it.
export async function findProcessDefinitionsForOrganisation(
  trx: Transaction<Database>,
  filter: FindProcessDefinitionsForOrganisationFilter = {},
): Promise<ProcessDefinition[]> {
  let query = trx.selectFrom('process_definitions').selectAll();

  if (filter.query) {
    query = query.where('name', 'ilike', `%${filter.query}%`);
  }

  // A definition_id tiebreak makes this a total order: two definitions
  // updated in the same instant would otherwise tie on updated_at alone,
  // which the route's own JS-side pagination (see process-definitions.ts's
  // GET /process-definitions/manage) depends on for a stable cursor.
  const rows = await query.orderBy('updated_at', 'desc').orderBy('definition_id', 'desc').execute();

  return rows.map(toDefinitionDomain);
}

export interface UpdateProcessDefinitionMetadataInput {
  name?: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
  owningGroupId?: string | null;
  retentionDays?: number | null;
}

// Definition-level metadata (name, description, category, icon), separate
// from the document the version carries. Callers are responsible for only
// invoking this while the definition's current work is still a draft; nothing
// here re-checks that, the same division of responsibility updateCaseState
// has with its own draft-only PATCH route.
export async function updateProcessDefinitionMetadata(
  trx: Transaction<Database>,
  definitionId: string,
  input: UpdateProcessDefinitionMetadataInput,
): Promise<ProcessDefinition> {
  const row = await trx
    .updateTable('process_definitions')
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.category !== undefined ? { category: input.category } : {}),
      ...(input.icon !== undefined ? { icon: input.icon } : {}),
      ...(input.owningGroupId !== undefined ? { owning_group_id: input.owningGroupId } : {}),
      ...(input.retentionDays !== undefined ? { retention_days: input.retentionDays } : {}),
      updated_at: new Date(),
    })
    .where('definition_id', '=', definitionId)
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDefinitionDomain(row);
}

export interface CreateProcessVersionInput {
  organisationId: string;
  definitionId: string;
  versionNumber: number;
  documentId: string;
  documentHash: string;
  changeNote?: string | null;
  publishedByUserId?: string | null;
}

export async function createProcessVersion(
  trx: Transaction<Database>,
  input: CreateProcessVersionInput,
): Promise<ProcessVersion> {
  const row = await trx
    .insertInto('process_versions')
    .values({
      version_id: generateId(),
      organisation_id: input.organisationId,
      definition_id: input.definitionId,
      version_number: input.versionNumber,
      document_id: input.documentId,
      document_hash: input.documentHash,
      change_note: input.changeNote ?? null,
      published_by_user_id: input.publishedByUserId ?? null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toVersionDomain(row);
}

export async function findProcessVersionById(
  trx: Transaction<Database>,
  versionId: string,
): Promise<ProcessVersion | null> {
  const row = await trx
    .selectFrom('process_versions')
    .selectAll()
    .where('version_id', '=', versionId)
    .executeTakeFirst();

  return row ? toVersionDomain(row) : null;
}

// The one open draft for a definition, if any. The create and "new version"
// endpoints only ever leave a definition with zero or one draft version at a
// time, so "the" is accurate; this is what the builder loads and saves to.
export async function findDraftProcessVersion(
  trx: Transaction<Database>,
  definitionId: string,
): Promise<ProcessVersion | null> {
  const row = await trx
    .selectFrom('process_versions')
    .selectAll()
    .where('definition_id', '=', definitionId)
    .where('status', '=', 'draft')
    .orderBy('version_number', 'desc')
    .executeTakeFirst();

  return row ? toVersionDomain(row) : null;
}

// The highest version_number a definition has used, across every status.
// The next draft's version_number is this plus one, so numbering survives
// a publish, an edit-again cycle regardless of how many drafts along the
// way were abandoned.
export async function findLatestVersionNumber(
  trx: Transaction<Database>,
  definitionId: string,
): Promise<number> {
  const row = await trx
    .selectFrom('process_versions')
    .select(({ fn }) => fn.max('version_number').as('max_version_number'))
    .where('definition_id', '=', definitionId)
    .executeTakeFirst();

  return row?.max_version_number ?? 0;
}

// Records a new content hash against a draft version after its document was
// edited in place (updateProcessDefinitionDocument in packages/documents).
// process_versions.document_hash is what verifyDocumentIntegrity checks a
// read document against, so a Mongo edit that does not update this row
// would make every subsequent read of the draft fail that check. Callers
// are responsible for only invoking this against a draft; nothing here
// re-checks status, the same division the rest of this file uses.
export async function updateProcessVersionDocumentHash(
  trx: Transaction<Database>,
  versionId: string,
  documentHash: string,
): Promise<ProcessVersion> {
  const row = await trx
    .updateTable('process_versions')
    .set({ document_hash: documentHash })
    .where('version_id', '=', versionId)
    .returningAll()
    .executeTakeFirstOrThrow();

  return toVersionDomain(row);
}

// Marks a version published and points the definition at it. Both rows
// change together, so this takes the caller's transaction rather than
// opening its own.
export async function publishProcessVersion(
  trx: Transaction<Database>,
  versionId: string,
  publishedByUserId: string,
): Promise<ProcessVersion> {
  const version = await trx
    .updateTable('process_versions')
    .set({ status: 'published', published_by_user_id: publishedByUserId, published_at: new Date() })
    .where('version_id', '=', versionId)
    .returningAll()
    .executeTakeFirstOrThrow();

  await trx
    .updateTable('process_definitions')
    .set({ status: 'published', current_version_id: versionId, updated_at: new Date() })
    .where('definition_id', '=', version.definition_id)
    .execute();

  return toVersionDomain(version);
}

// ADR-0013: allocates the next case reference for a definition, e.g.
// LAP-000123.
//
// The increment and the read are a single UPDATE ... RETURNING, so Postgres
// holds a row lock for the duration and two concurrent submissions cannot
// receive the same number. Doing it as SELECT-then-UPDATE would be a
// textbook race. Because it runs inside the caller's submit transaction, a
// rolled-back submission leaves a gap in the sequence rather than reusing
// the number; gaps are the correct trade, since a reference that once
// identified an attempted submission should never later identify a
// different case.
export async function allocateCaseReference(
  trx: Transaction<Database>,
  definitionId: string,
): Promise<string> {
  const row = await trx
    .updateTable('process_definitions')
    // Raw SQL rather than the expression builder: reference_counter is a
    // BIGINT, which Kysely types as a string (node-postgres returns it as
    // one), so a numeric literal will not typecheck against it.
    .set({ reference_counter: sql<string>`reference_counter + 1` })
    .where('definition_id', '=', definitionId)
    .returning(['reference_prefix', 'reference_counter'])
    .executeTakeFirstOrThrow();

  return `${row.reference_prefix}-${String(row.reference_counter).padStart(6, '0')}`;
}
