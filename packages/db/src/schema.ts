import type { Generated } from 'kysely';

// Kysely's own table shapes: snake_case, matching the migrated columns
// exactly. This is the one mapping boundary between camelCase TypeScript
// and snake_case Postgres (CLAUDE.md §4); repositories translate to and
// from @orgflow/types domain objects, nothing outside packages/db sees
// these interfaces.

export interface OrganisationsTable {
  organisation_id: string;
  name: string;
  slug: string;
  status: Generated<string>;
  branding: Generated<Record<string, unknown>>;
  settings: Generated<Record<string, unknown>>;
  created_by_user_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UsersTable {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  status: Generated<string>;
  last_login_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface UserIdentitiesTable {
  user_identity_id: string;
  user_id: string;
  provider_id: string | null;
  subject: string;
  issuer: string;
  created_at: Generated<Date>;
}

export interface OrganisationMembersTable {
  organisation_member_id: string;
  organisation_id: string;
  user_id: string;
  roles: Generated<string[]>;
  job_title: string | null;
  department: string | null;
  line_manager_user_id: string | null;
  status: Generated<string>;
  joined_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface InvitationsTable {
  invitation_id: string;
  organisation_id: string;
  email: string;
  roles: Generated<string[]>;
  token_hash: string;
  invited_by_user_id: string;
  expires_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
  created_at: Generated<Date>;
}

export interface IdentityProvidersTable {
  provider_id: string;
  organisation_id: string;
  type: string;
  display_name: string;
  issuer_url: string;
  client_id: string;
  client_secret_ref: string;
  email_domains: Generated<string[]>;
  enabled: Generated<boolean>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GroupsTable {
  group_id: string;
  organisation_id: string;
  name: string;
  description: string | null;
  created_at: Generated<Date>;
}

export interface GroupMembersTable {
  group_member_id: string;
  organisation_id: string;
  group_id: string;
  user_id: string;
  created_at: Generated<Date>;
}

export interface AuditEventsTable {
  audit_event_id: string;
  organisation_id: string;
  actor_user_id: string | null;
  actor_type: Generated<string>;
  entity_type: string;
  entity_id: string | null;
  action: string;
  payload: Generated<Record<string, unknown>>;
  correlation_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  occurred_at: Generated<Date>;
}

export interface IdempotencyKeysTable {
  idempotency_key: string;
  organisation_id: string | null;
  consumer: string;
  result: Record<string, unknown> | null;
  created_at: Generated<Date>;
  expires_at: Date;
}

export interface Database {
  organisations: OrganisationsTable;
  users: UsersTable;
  user_identities: UserIdentitiesTable;
  organisation_members: OrganisationMembersTable;
  invitations: InvitationsTable;
  identity_providers: IdentityProvidersTable;
  groups: GroupsTable;
  group_members: GroupMembersTable;
  audit_events: AuditEventsTable;
  idempotency_keys: IdempotencyKeysTable;
}
