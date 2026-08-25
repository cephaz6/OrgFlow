export { createDb } from './connection.js';
export type { DbConnectionConfig } from './connection.js';
export { pingDatabase } from './health.js';
export { withTenantTransaction } from './tenant-transaction.js';
export { generateId } from './uuid.js';
export type { Database } from './schema.js';
export {
  countActiveOwnersForCurrentTenant,
  findActiveMembersWithRole,
  findMemberDirectoryForCurrentTenant,
  findOrganisationMemberByUserId,
  findOrganisationMembersForCurrentTenant,
  insertOrganisationMember,
  setLineManager,
  updateOrganisationMember,
} from './repositories/organisation-members.js';
export type {
  InsertOrganisationMemberInput,
  MemberDirectoryFilter,
  UpdateOrganisationMemberInput,
} from './repositories/organisation-members.js';
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
export {
  createOrganisation,
  findOrganisationById,
  findOrganisationBySlug,
} from './repositories/organisations.js';
export type { CreateOrganisationInput } from './repositories/organisations.js';
export {
  createInvitation,
  findInvitationByTokenHash,
  findInvitationsForCurrentTenant,
  markInvitationAccepted,
  revokeInvitation,
} from './repositories/invitations.js';
export type { CreateInvitationInput } from './repositories/invitations.js';
export {
  createUserWithIdentity,
  findUserByEmail,
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
} from './repositories/process-definitions.js';
export type {
  CreateProcessDefinitionInput,
  CreateProcessVersionInput,
  UpdateProcessDefinitionMetadataInput,
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
  markTaskEscalated,
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
export {
  cancelTimersForCase,
  cancelTimersForTask,
  createSlaTimer,
  findDueTimers,
  markTimerFired,
} from './repositories/sla-timers.js';
export type { CreateSlaTimerInput } from './repositories/sla-timers.js';
export {
  createDelegation,
  deleteDelegation,
  findActiveDelegateByUserId,
  findDelegationById,
  findDelegationsForUser,
} from './repositories/delegations.js';
export type { CreateDelegationInput } from './repositories/delegations.js';
export {
  findApproverLoad,
  findBottlenecksAcrossDefinitions,
  findEscalationAndReturnRates,
  findRejectionCountsByStep,
  findStepDurations,
  findTurnaroundStats,
  findVolumeByDefinition,
} from './repositories/reports.js';
export type {
  ApproverLoadRow,
  BottleneckRow,
  EscalationAndReturnRates,
  RejectionCountRow,
  ReportDateRange,
  StepDurationRow,
  TurnaroundStats,
  VolumeRow,
} from './repositories/reports.js';
