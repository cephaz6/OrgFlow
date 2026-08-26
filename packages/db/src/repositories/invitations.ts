import type { Kysely, Selectable, Transaction } from 'kysely';
import type { Invitation, OrganisationRole } from '@orgflow/types';

import { clampPageSize } from '../pagination.js';
import type { Database, InvitationsTable } from '../schema.js';
import { generateId } from '../uuid.js';

function toDomain(row: Selectable<InvitationsTable>): Invitation {
  return {
    invitationId: row.invitation_id,
    organisationId: row.organisation_id,
    email: row.email,
    roles: row.roles as OrganisationRole[],
    invitedByUserId: row.invited_by_user_id,
    expiresAt: row.expires_at.toISOString(),
    acceptedAt: row.accepted_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export interface CreateInvitationInput {
  organisationId: string;
  email: string;
  roles: OrganisationRole[];
  tokenHash: string;
  invitedByUserId: string;
  expiresAt: Date;
}

// PRD.md §11.2's POST /invitations. Tenant-scoped like every write in this
// package; the caller runs this inside withTenantTransaction for the
// inviting admin's own organisation, so the partial unique index
// (organisation_id, email) WHERE accepted_at IS NULL AND revoked_at IS NULL
// is what actually prevents two pending invitations to the same address,
// not application logic.
export async function createInvitation(
  trx: Transaction<Database>,
  input: CreateInvitationInput,
): Promise<Invitation> {
  const row = await trx
    .insertInto('invitations')
    .values({
      invitation_id: generateId(),
      organisation_id: input.organisationId,
      email: input.email,
      roles: input.roles,
      token_hash: input.tokenHash,
      invited_by_user_id: input.invitedByUserId,
      expires_at: input.expiresAt,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  return toDomain(row);
}

export interface FindInvitationsFilter {
  // Free text over email. Absent means no filter rather than an empty
  // search, which would otherwise match nothing.
  query?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface InvitationPage {
  invitations: Invitation[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function findInvitationsForCurrentTenant(
  trx: Transaction<Database>,
  filter: FindInvitationsFilter = {},
): Promise<InvitationPage> {
  let query = trx.selectFrom('invitations').selectAll();

  if (filter.query) {
    query = query.where('email', 'ilike', `%${filter.query}%`);
  }

  if (filter.cursor) {
    query = query.where('invitation_id', '<', filter.cursor);
  }

  const limit = clampPageSize(filter.limit);

  // ORDER BY invitation_id, not created_at: ADR-0003's UUID v7 ids are
  // time-sortable, so this produces the exact same order as created_at
  // descending did, while letting the id itself be the cursor, matching
  // findCasesForCurrentTenant's pattern (one row beyond the page, so
  // hasMore is answered without a second count query).
  const rows = await query
    .orderBy('invitation_id', 'desc')
    .limit(limit + 1)
    .execute();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    invitations: page.map(toDomain),
    nextCursor: hasMore ? (page[page.length - 1]?.invitation_id ?? null) : null,
    hasMore,
  };
}

// Scoped by RLS like every other tenant read in this file: a token that
// resolves to another organisation's invitation cannot be revoked from
// here, and the caller gets the same 404 a genuinely unknown id would.
export async function revokeInvitation(
  trx: Transaction<Database>,
  invitationId: string,
): Promise<Invitation | null> {
  const row = await trx
    .updateTable('invitations')
    .set({ revoked_at: new Date() })
    .where('invitation_id', '=', invitationId)
    .where('accepted_at', 'is', null)
    .where('revoked_at', 'is', null)
    .returningAll()
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

// Deliberate exception in the shape of ADR-0011's two: resolving a token
// into an invitation is inherently cross-tenant, and happens before the
// caller has any organisation context to scope a transaction by (that is
// exactly what this lookup exists to establish). Runs on the plain,
// unscoped connection, never withTenantTransaction. Narrow by construction:
// takes only a token hash, never an organisationId, and is not exported
// from the package barrel for anything but the invitations route to call.
export async function findInvitationByTokenHash(
  db: Kysely<Database>,
  tokenHash: string,
): Promise<Invitation | null> {
  const row = await db
    .selectFrom('invitations')
    .selectAll()
    .where('token_hash', '=', tokenHash)
    .executeTakeFirst();

  return row ? toDomain(row) : null;
}

// Runs inside the tenant transaction the accept route opens once it has
// resolved the invitation's organisationId from the unscoped lookup above,
// so this one is ordinarily scoped like every other write.
export async function markInvitationAccepted(
  trx: Transaction<Database>,
  invitationId: string,
): Promise<void> {
  await trx
    .updateTable('invitations')
    .set({ accepted_at: new Date() })
    .where('invitation_id', '=', invitationId)
    .execute();
}
