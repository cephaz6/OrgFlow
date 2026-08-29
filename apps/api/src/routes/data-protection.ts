import {
  appendAuditEvent,
  findAllAttachmentsUploadedByUser,
  findAllAuditEventsForActor,
  findAllCasesSubmittedByUser,
  findAllCaseTasksForUser,
  findOrganisationMemberByUserId,
  findUserById,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { readCaseValues } from '@orgflow/documents';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import type { MongoClient } from 'mongodb';
import { z } from 'zod';

import { isAdministrator } from '../cases/permissions.js';
import { parseBody } from '../lib/parse-body.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf } from '../middleware/require-session.js';

export interface DataProtectionDeps {
  db: Kysely<Database>;
  mongoClient: MongoClient;
  sessionSecret: string;
}

const querySchema = z.object({
  userId: z.string().uuid(),
});

// PRD.md §12.2/§18 gives data protection duties, including subject access
// export, to admin and owner, the same gate members.ts and identity-
// providers.ts already use for the organisation's other sensitive
// administration surfaces.
//
// Scope, deliberately: this covers cases the subject submitted, tasks they
// were assigned, claimed, completed or delegated from, every audit event
// naming them as actor, and every attachment they uploaded. It does not
// attempt to find every case where the subject is merely *named* inside
// someone else's form data (for example, chosen as a line manager or
// delegate in a `user`-type field on a case they did not submit and hold
// no task on): that would mean loading every case's pinned definition
// document to learn which field keys are type `user`, then scanning every
// case's Mongo values for a match, which is real, separate work this slice
// does not attempt. Recorded as a documented follow-up (ADR-0029), not a
// silently incomplete export.
export function createDataProtectionRouter(deps: DataProtectionDeps): Router {
  const router = Router();

  router.use('/data-protection', requireSession(deps.sessionSecret));

  router.get('/data-protection/subject-export', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const { userId } = parseBody(querySchema, req.query);

      const result = await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'A subject access export requires the admin or owner role.',
          );
        }

        // Cross-tenant reads as absent under RLS (PRD.md §11.10, ADR-0015):
        // a userId that is not a member of this organisation gets the same
        // 404 a genuinely unknown one does.
        const member = await findOrganisationMemberByUserId(trx, userId);
        if (!member) {
          throw new HttpProblemError(404, 'Not Found', 'No such member.');
        }

        const [user, cases, tasks, auditEvents, attachments] = await Promise.all([
          findUserById(trx, userId),
          findAllCasesSubmittedByUser(trx, userId),
          findAllCaseTasksForUser(trx, userId),
          findAllAuditEventsForActor(trx, userId),
          findAllAttachmentsUploadedByUser(trx, userId),
        ]);

        if (!user) {
          throw new HttpProblemError(404, 'Not Found', 'No such member.');
        }

        const casesWithValues = await Promise.all(
          cases.map(async (c) => ({
            caseId: c.caseId,
            reference: c.reference,
            title: c.title,
            status: c.status,
            outcome: c.outcome,
            currentStepKey: c.currentStepKey,
            submittedAt: c.submittedAt,
            completedAt: c.completedAt,
            redactedAt: c.redactedAt,
            values: await readCaseValues(deps.mongoClient, session.organisationId, c.caseId),
          })),
        );

        await appendAuditEvent(trx, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          entityType: 'user',
          entityId: userId,
          action: 'subject_access_export.requested',
        });

        return {
          user: {
            userId: user.userId,
            email: user.email,
            displayName: user.displayName,
          },
          membership: {
            roles: member.roles,
            status: member.status,
            jobTitle: member.jobTitle,
            department: member.department,
            lineManagerUserId: member.lineManagerUserId,
            joinedAt: member.joinedAt,
          },
          casesSubmitted: casesWithValues,
          tasks: tasks.map((task) => ({
            taskId: task.taskId,
            caseId: task.caseId,
            stepName: task.stepName,
            status: task.status,
            decision: task.decision,
            comment: task.comment,
            assigneeUserId: task.assigneeUserId,
            claimedByUserId: task.claimedByUserId,
            claimedAt: task.claimedAt,
            completedByUserId: task.completedByUserId,
            completedAt: task.completedAt,
            delegatedFromUserId: task.delegatedFromUserId,
          })),
          auditEvents: auditEvents.map((event) => ({
            auditEventId: event.auditEventId,
            entityType: event.entityType,
            entityId: event.entityId,
            action: event.action,
            occurredAt: event.occurredAt,
          })),
          attachmentsUploaded: attachments.map((attachment) => ({
            attachmentId: attachment.attachmentId,
            caseId: attachment.caseId,
            fieldKey: attachment.fieldKey,
            filename: attachment.filename,
            sizeBytes: attachment.sizeBytes,
            scanStatus: attachment.scanStatus,
            confirmedAt: attachment.confirmedAt,
            deletedAt: attachment.deletedAt,
          })),
        };
      });

      res.status(200).json({ ...result, exportedAt: new Date().toISOString() });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
