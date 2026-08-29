// The shape GET /data-protection/subject-export returns (apps/api/src/
// routes/data-protection.ts). Deliberately not the full domain shape of a
// case, task, audit event or attachment: only what an export screen needs
// to show a person, trimmed the same way MemberEntry trims
// OrganisationMemberSummary.
export interface SubjectExportCase {
  caseId: string;
  reference: string;
  title: string;
  status: string;
  outcome: string | null;
  currentStepKey: string | null;
  submittedAt: string | null;
  completedAt: string | null;
  redactedAt: string | null;
  values: Record<string, unknown>;
}

export interface SubjectExportTask {
  taskId: string;
  caseId: string;
  stepName: string;
  status: string;
  decision: string | null;
  comment: string | null;
  assigneeUserId: string | null;
  claimedByUserId: string | null;
  claimedAt: string | null;
  completedByUserId: string | null;
  completedAt: string | null;
  delegatedFromUserId: string | null;
}

export interface SubjectExportAuditEvent {
  auditEventId: string;
  entityType: string;
  entityId: string | null;
  action: string;
  occurredAt: string;
}

export interface SubjectExportAttachment {
  attachmentId: string;
  caseId: string;
  fieldKey: string;
  filename: string;
  sizeBytes: number;
  scanStatus: string;
  confirmedAt: string | null;
  deletedAt: string | null;
}

export interface SubjectExport {
  user: {
    userId: string;
    email: string;
    displayName: string;
  };
  membership: {
    roles: string[];
    status: string;
    jobTitle: string | null;
    department: string | null;
    lineManagerUserId: string | null;
    joinedAt: string;
  };
  casesSubmitted: SubjectExportCase[];
  tasks: SubjectExportTask[];
  auditEvents: SubjectExportAuditEvent[];
  attachmentsUploaded: SubjectExportAttachment[];
  exportedAt: string;
}
