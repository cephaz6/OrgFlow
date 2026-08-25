import type { Kysely, Selectable, Transaction } from 'kysely';
import type { Invitation, OrganisationRole } from '@orgflow/types';

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

export async function findInvitationsForCurrentTenant(
  trx: Transaction<Database>,
): Promise<Invitation[]> {
  const rows = await trx
    .selectFrom('invitations')
    .selectAll()
    .orderBy('created_at', 'desc')
    .execute();

  return rows.map(toDomain);
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
