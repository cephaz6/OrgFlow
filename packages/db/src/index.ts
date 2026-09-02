export { createDb } from './connection.js';
export type { DbConnectionConfig } from './connection.js';
export { pingDatabase } from './health.js';
export { withTenantTransaction } from './tenant-transaction.js';
export { generateId } from './uuid.js';
export {
  clampPageSize,
  decodeCompositeCursor,
  DEFAULT_PAGE_SIZE,
  encodeCompositeCursor,
  MAX_PAGE_SIZE,
} from './pagination.js';
export type { Database } from './schema.js';
export {
  countActiveOwnersForCurrentTenant,
  findActiveMembersWithRole,
  findMemberDirectoryEntryByUserId,
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
  MemberDirectoryPage,
  UpdateOrganisationMemberInput,
} from './repositories/organisation-members.js';
export {
  createGroup,
  deleteGroup,
  ensureGroup,
  ensureGroupMember,
  findGroupIdsByKeyForCurrentTenant,
  findGroupIdsForUser,
  findGroupMembersForGroup,
  findGroupMemberUserIds,
  findGroupsForOrganisation,
  removeGroupMember,
  updateGroup,
} from './repositories/groups.js';
export type {
  EnsureGroupInput,
  Group,
  GroupMember,
  UpdateGroupInput,
} from './repositories/groups.js';
export {
  buildIdempotencyKey,
  claimNotification,
  countUnreadNotifications,
  findNotificationsForCase,
  findNotificationsForRecipient,
  markAllNotificationsRead,
  markNotificationFailed,
  markNotificationRead,
  markNotificationSent,
} from './repositories/notifications.js';
export type {
  ClaimedNotification,
  ClaimNotificationInput,
  FindNotificationsForRecipientFilter,
  NotificationPage,
} from './repositories/notifications.js';
export {
  findNotificationPreference,
  findNotificationPreferencesForUser,
  setNotificationPreference,
} from './repositories/notification-preferences.js';
export type {
  NotificationPreference,
  SetNotificationPreferenceInput,
} from './repositories/notification-preferences.js';
export {
  createTemplate,
  deleteTemplate,
  findSystemTemplateById,
  findTemplateById,
  listBrowsableTemplates,
  setTemplateScope,
  updateTemplate,
} from './repositories/templates.js';
export type {
  BrowsableTemplate,
  CreateTemplateInput,
  TemplateDetail,
  UpdateTemplateInput,
} from './repositories/templates.js';
export {
  addHoliday,
  findOrganisationCalendar,
  removeHoliday,
  resolveWorkingCalendar,
  upsertOrganisationCalendar,
} from './repositories/working-calendar.js';
export type {
  AddHolidayInput,
  Holiday,
  OrganisationCalendar,
  UpsertCalendarInput,
} from './repositories/working-calendar.js';
export { findMembershipsForUser } from './repositories/memberships.js';
export {
  createIdentityProvider,
  deleteIdentityProvider,
  findIdentityProviderByEmailDomain,
  findIdentityProvidersForOrganisation,
  updateIdentityProvider,
} from './repositories/identity-providers.js';
export type {
  CreateIdentityProviderInput,
  IdentityProviderRecord,
  UpdateIdentityProviderInput,
} from './repositories/identity-providers.js';
export {
  createOrganisation,
  findOrganisationById,
  findOrganisationBySlug,
  updateOrganisation,
} from './repositories/organisations.js';
export type {
  CreateOrganisationInput,
  UpdateOrganisationInput,
} from './repositories/organisations.js';
export {
  createInvitation,
  findInvitationByTokenHash,
  findInvitationsForCurrentTenant,
  markInvitationAccepted,
  revokeInvitation,
} from './repositories/invitations.js';
export type {
  CreateInvitationInput,
  FindInvitationsFilter,
  InvitationPage,
} from './repositories/invitations.js';
export {
  createTaskDecisionToken,
  findTaskDecisionTokenByHash,
  markTaskDecisionTokenUsed,
} from './repositories/task-decision-tokens.js';
export type {
  CreateTaskDecisionTokenInput,
  TaskDecisionToken,
} from './repositories/task-decision-tokens.js';
export {
  createUserWithIdentity,
  ensurePlatformAdmin,
  findUserByEmail,
  findUserByIdentity,
  findUserById,
  findUsersByIds,
  touchLastLogin,
} from './repositories/users.js';
export type { CreateUserWithIdentityInput } from './repositories/users.js';
export { ensureDevUser } from './repositories/dev-seed.js';
export type { DevSeedResult } from './repositories/dev-seed.js';
export {
  appendAuditEvent,
  findAllAuditEventsForActor,
  findAuditEventsForCase,
} from './repositories/audit-events.js';
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
  FindProcessDefinitionsForOrganisationFilter,
  FindPublishedProcessDefinitionsFilter,
  ProcessDefinitionPage,
  UpdateProcessDefinitionMetadataInput,
} from './repositories/process-definitions.js';
export {
  CaseConcurrencyError,
  createCase,
  findAllCasesSubmittedByUser,
  findCaseById,
  findCasesEligibleForRedaction,
  findCasesForCurrentTenant,
  isDraftReference,
  markCaseRedacted,
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
  findAllCaseTasksForUser,
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
  TaskQueuePage,
} from './repositories/case-tasks.js';
export {
  appendCaseTransition,
  findCaseTransitionsForCase,
} from './repositories/case-transitions.js';
export type { AppendCaseTransitionInput } from './repositories/case-transitions.js';
export {
  createCaseComment,
  findCaseCommentById,
  findCommentsForCase,
} from './repositories/case-comments.js';
export type {
  CreateCaseCommentInput,
  FindCaseCommentsOptions,
} from './repositories/case-comments.js';
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
  findDelegationsForOrganisation,
  findDelegationsForUser,
} from './repositories/delegations.js';
export type {
  CreateDelegationInput,
  DelegationPage,
  FindDelegationsForOrganisationFilter,
  FindDelegationsForUserFilter,
} from './repositories/delegations.js';
export {
  countConfirmedAttachmentsForField,
  createAttachment,
  findAllAttachmentsUploadedByUser,
  findAttachmentById,
  findConfirmedAttachmentsForCase,
  markAttachmentConfirmed,
  markAttachmentScanned,
  redactAttachment,
  softDeleteAttachment,
} from './repositories/attachments.js';
export type {
  CreateAttachmentInput,
  MarkAttachmentScannedInput,
} from './repositories/attachments.js';
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
