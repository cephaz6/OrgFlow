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
  // ADR-0014: the stable identifier a definition document's `groupKey`
  // resolves against, so renaming a group cannot break a pinned version.
  key: string;
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

export interface ProcessDefinitionsTable {
  definition_id: string;
  organisation_id: string;
  key: string;
  name: string;
  description: string | null;
  category: string | null;
  icon: string | null;
  status: Generated<string>;
  current_version_id: string | null;
  reference_prefix: string;
  // BIGINT: node-postgres returns it as a string to avoid the precision
  // loss a JS number would suffer past 2^53. The repository parses it.
  reference_counter: Generated<string>;
  retention_days: number | null;
  // ADR-0026: optional, additive. A processOwner who is also a member of
  // this group may manage the definition, alongside its creator.
  owning_group_id: string | null;
  created_by_user_id: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ProcessVersionsTable {
  version_id: string;
  organisation_id: string;
  definition_id: string;
  version_number: number;
  document_id: string;
  document_hash: string;
  status: Generated<string>;
  change_note: string | null;
  published_by_user_id: string | null;
  published_at: Date | null;
  created_at: Generated<Date>;
}

export interface CasesTable {
  case_id: string;
  organisation_id: string;
  definition_id: string;
  version_id: string;
  reference: string;
  title: string;
  status: Generated<string>;
  outcome: string | null;
  current_step_key: string | null;
  values_document_id: string | null;
  submitted_by_user_id: string;
  submitted_at: Date | null;
  completed_at: Date | null;
  due_at: Date | null;
  row_version: Generated<number>;
  redacted_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CaseTasksTable {
  task_id: string;
  organisation_id: string;
  case_id: string;
  step_key: string;
  step_name: string;
  task_type: string;
  assignment_strategy: string;
  assignee_user_id: string | null;
  assignee_group_id: string | null;
  assignee_role: string | null;
  delegated_from_user_id: string | null;
  status: Generated<string>;
  decision: string | null;
  comment: string | null;
  due_at: Date | null;
  escalation_level: Generated<number>;
  escalated_at: Date | null;
  claimed_by_user_id: string | null;
  claimed_at: Date | null;
  completed_by_user_id: string | null;
  completed_at: Date | null;
  row_version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface CaseTransitionsTable {
  transition_id: string;
  organisation_id: string;
  case_id: string;
  from_step_key: string | null;
  to_step_key: string | null;
  trigger_type: string;
  triggered_by_user_id: string | null;
  task_id: string | null;
  condition_result: Record<string, unknown> | null;
  occurred_at: Generated<Date>;
}

export interface CaseCommentsTable {
  comment_id: string;
  organisation_id: string;
  case_id: string;
  author_user_id: string;
  body: string;
  visibility: Generated<string>;
  created_at: Generated<Date>;
}

export interface NotificationsTable {
  notification_id: string;
  organisation_id: string;
  recipient_user_id: string;
  case_id: string | null;
  task_id: string | null;
  channel: string;
  template_key: string;
  subject: string | null;
  status: Generated<string>;
  read_at: Date | null;
  sent_at: Date | null;
  failure_reason: string | null;
  // PRD.md §14.2: eventId + recipientUserId + templateKey, joined into one
  // value so the database's UNIQUE constraint can enforce it.
  idempotency_key: string;
  created_at: Generated<Date>;
}

export interface SlaTimersTable {
  timer_id: string;
  organisation_id: string;
  case_id: string;
  task_id: string | null;
  schedule_name: string;
  timer_type: string;
  escalation_level: Generated<number>;
  fire_at: Date;
  status: Generated<string>;
  fired_at: Date | null;
  created_at: Generated<Date>;
}

export interface DelegationsTable {
  delegation_id: string;
  organisation_id: string;
  from_user_id: string;
  to_user_id: string;
  starts_at: Date;
  ends_at: Date;
  reason: string | null;
  created_at: Generated<Date>;
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
  process_definitions: ProcessDefinitionsTable;
  process_versions: ProcessVersionsTable;
  cases: CasesTable;
  case_tasks: CaseTasksTable;
  case_transitions: CaseTransitionsTable;
  case_comments: CaseCommentsTable;
  notifications: NotificationsTable;
  sla_timers: SlaTimersTable;
  delegations: DelegationsTable;
}
