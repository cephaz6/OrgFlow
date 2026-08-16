export { createDb } from './connection.js';
export type { DbConnectionConfig } from './connection.js';
export { pingDatabase } from './health.js';
export { withTenantTransaction } from './tenant-transaction.js';
export { generateId } from './uuid.js';
export type { Database } from './schema.js';
export {
  findActiveMembersWithRole,
  findOrganisationMemberByUserId,
  findOrganisationMembersForCurrentTenant,
  insertOrganisationMember,
  setLineManager,
} from './repositories/organisation-members.js';
export type { InsertOrganisationMemberInput } from './repositories/organisation-members.js';
export {
  ensureGroup,
  ensureGroupMember,
  findGroupIdsByKeyForCurrentTenant,
  findGroupIdsForUser,
  findGroupMemberUserIds,
} from './repositories/groups.js';
export type { EnsureGroupInput } from './repositories/groups.js';
export {
  buildIdempotencyKey,
  claimNotification,
  findNotificationsForCase,
  findNotificationsForRecipient,
  markNotificationFailed,
  markNotificationSent,
} from './repositories/notifications.js';
export type { ClaimedNotification, ClaimNotificationInput } from './repositories/notifications.js';
export { findMembershipsForUser } from './repositories/memberships.js';
export {
  createIdentityProvider,
  findIdentityProviderByEmailDomain,
} from './repositories/identity-providers.js';
export type {
  CreateIdentityProviderInput,
  IdentityProviderRecord,
} from './repositories/identity-providers.js';
export { createOrganisation, findOrganisationBySlug } from './repositories/organisations.js';
export type { CreateOrganisationInput } from './repositories/organisations.js';
export {
  createUserWithIdentity,
  findUserByIdentity,
  findUserById,
  touchLastLogin,
} from './repositories/users.js';
export type { CreateUserWithIdentityInput } from './repositories/users.js';
export { ensureDevUser } from './repositories/dev-seed.js';
export type { DevSeedResult } from './repositories/dev-seed.js';
export { appendAuditEvent, findAuditEventsForCase } from './repositories/audit-events.js';
export type { AppendAuditEventInput } from './repositories/audit-events.js';
export {
  allocateCaseReference,
  createProcessDefinition,
  createProcessVersion,
  findProcessDefinitionById,
  findProcessDefinitionByKey,
  findProcessVersionById,
  findPublishedProcessDefinitions,
  publishProcessVersion,
} from './repositories/process-definitions.js';
export type {
  CreateProcessDefinitionInput,
  CreateProcessVersionInput,
} from './repositories/process-definitions.js';
export {
  CaseConcurrencyError,
  createCase,
  findCaseById,
  findCasesForCurrentTenant,
  isDraftReference,
  updateCaseState,
} from './repositories/cases.js';
export type {
  CasePage,
  CreateCaseInput,
  FindCasesFilter,
  UpdateCaseStateInput,
} from './repositories/cases.js';
export {
  cancelOpenTasksForCase,
  claimCaseTask,
  createCaseTask,
  findCaseTaskById,
  findCaseTasksForCase,
  findClaimableTaskQueue,
  findClaimableTasks,
  findOpenTasksForAssignee,
  findTaskQueueForAssignee,
  hasUserHeldTaskOnCase,
  recordTaskDecision,
  TaskConcurrencyError,
} from './repositories/case-tasks.js';
export type {
  CreateCaseTaskInput,
  RecordTaskDecisionInput,
  TaskQueueEntry,
  TaskQueueFilter,
} from './repositories/case-tasks.js';
export {
  appendCaseTransition,
  findCaseTransitionsForCase,
} from './repositories/case-transitions.js';
export type { AppendCaseTransitionInput } from './repositories/case-transitions.js';
