import {
  appendAuditEvent,
  findCasesEligibleForRedaction,
  findConfirmedAttachmentsForCase,
  findProcessVersionById,
  markCaseRedacted,
  redactAttachment,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import {
  findProcessDefinitionDocumentById,
  readCaseValues,
  upsertCaseValues,
  verifyDocumentIntegrity,
} from '@orgflow/documents';
import type { FileStore } from '@orgflow/storage';
import type { Case, FormField, ProcessDefinitionDocument } from '@orgflow/types';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';

import type { Logger } from '../logger.js';

export interface RetentionSweepDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
  fileStore: FileStore;
  logger: Logger;
}

// PRD.md §18: "a scheduled Lambda finds expired cases nightly [and redacts
// them]". Same local substitute as sla/sweep.ts's startSlaSweep, for the
// same reason: the production design needs AWS deployed to exist at all.
// Once a day, not sla/sweep.ts's 30 seconds: redaction is not time-
// sensitive the way a reminder or escalation is, and there is no local/
// demo reason to see it fire quickly.
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;

const TOMBSTONE = '[REDACTED]';

export interface RetentionSweepHandle {
  stop: () => void;
}

export function startRetentionSweep(
  deps: RetentionSweepDeps,
  intervalMs = DEFAULT_INTERVAL_MS,
): RetentionSweepHandle {
  const timer = setInterval(() => {
    void runRetentionSweepOnce(deps).catch((err) => {
      deps.logger.error({ err }, 'retention sweep iteration failed');
    });
  }, intervalMs);

  timer.unref?.();

  return { stop: () => clearInterval(timer) };
}

export async function runRetentionSweepOnce(deps: RetentionSweepDeps): Promise<void> {
  const eligible = await findCasesEligibleForRedaction(deps.db, new Date());

  for (const eligibleCase of eligible) {
    try {
      await redactCase(deps, eligibleCase);
    } catch (err) {
      // One case failing to redact (a missing document, a storage error)
      // must not stop the rest of the batch, and must not mark it redacted
      // by accident: it stays eligible and is retried on the next sweep.
      deps.logger.error({ err, caseId: eligibleCase.caseId }, 'failed to redact a case');
    }
  }
}

// Every field this document declares personal, across the request form and
// every step's own output fields: a field an approver fills in (for
// example, a delegate's name) carries personal data exactly as much as one
// the requester filled in, and PRD.md §5.4's containsPersonalData flag does
// not distinguish where in the document a field sits.
function collectPersonalDataFieldKeys(document: ProcessDefinitionDocument): string[] {
  const fields: FormField[] = [
    ...document.form.sections.flatMap((section) => section.fields),
    ...document.workflow.steps.flatMap((step) => step.outputFields ?? []),
  ];

  return fields.filter((field) => field.containsPersonalData).map((field) => field.key);
}

async function redactCase(deps: RetentionSweepDeps, eligibleCase: Case): Promise<void> {
  await withTenantTransaction(deps.db, eligibleCase.organisationId, async (trx) => {
    const version = await findProcessVersionById(trx, eligibleCase.versionId);
    if (!version) {
      // The pinned version this case ran against no longer exists, which
      // should not happen (versions are never deleted), but is not this
      // sweep's job to repair. Skipped rather than thrown, so the batch
      // continues; it stays eligible for the next run.
      return;
    }

    const document = await findProcessDefinitionDocumentById(
      deps.mongoClient,
      eligibleCase.organisationId,
      version.documentId,
    );
    if (!document || !verifyDocumentIntegrity(document, version.documentHash)) {
      return;
    }

    const personalFieldKeys = collectPersonalDataFieldKeys(document);
    const values = await readCaseValues(
      deps.mongoClient,
      eligibleCase.organisationId,
      eligibleCase.caseId,
    );

    const redactedValues: Record<string, unknown> = { ...values };
    let valuesChanged = false;
    for (const key of personalFieldKeys) {
      if (key in redactedValues) {
        redactedValues[key] = TOMBSTONE;
        valuesChanged = true;
      }
    }

    if (valuesChanged) {
      await upsertCaseValues(deps.mongoClient, {
        organisationId: eligibleCase.organisationId,
        caseId: eligibleCase.caseId,
        values: redactedValues,
        now: new Date().toISOString(),
      });
    }

    const attachments = await findConfirmedAttachmentsForCase(trx, eligibleCase.caseId);
    const redactedAt = new Date();
    for (const attachment of attachments) {
      // Best-effort against the object store: deleteObject is not
      // transactional with the Postgres write below (the same real-world
      // limitation the confirm/download flows already accept), so a
      // storage failure here throws and leaves the whole case un-redacted
      // for a retry, rather than marking it redacted with the object
      // still live.
      await deps.fileStore.deleteObject(attachment.storageKey);
      await redactAttachment(trx, attachment.attachmentId, redactedAt);
    }

    await markCaseRedacted(trx, eligibleCase.caseId, redactedAt);

    // PRD.md §18: "the redaction is itself an audit event." The audit
    // skeleton this leaves behind (who decided what, and when) is every
    // audit_events row already written for this case over its lifetime;
    // this one records the redaction alongside them, not in place of them.
    await appendAuditEvent(trx, {
      organisationId: eligibleCase.organisationId,
      actorUserId: null,
      actorType: 'scheduler',
      entityType: 'case',
      entityId: eligibleCase.caseId,
      action: 'case.redacted',
      payload: {
        fieldsRedacted: personalFieldKeys.filter((key) => key in values),
        attachmentsRedacted: attachments.length,
      },
    });
  });
}
