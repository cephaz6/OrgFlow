import {
  countUnreadNotifications,
  findNotificationPreferencesForUser,
  findNotificationsForRecipient,
  markAllNotificationsRead,
  markNotificationRead,
  setNotificationPreference,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { parseBody } from '../lib/parse-body.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf } from '../middleware/require-session.js';

export interface NotificationsDeps {
  db: Kysely<Database>;
  sessionSecret: string;
}

const listQuerySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().positive().optional(),
  cursor: z.string().min(1).optional(),
});

// Only the templates something actually dispatches (workers/src/
// notifications/dispatch.ts's own HANDLED map), not every key PRD.md §14.1
// eventually names: offering a toggle for a notification that can never
// fire would be a control that does nothing, which is worse than no
// control at all.
const PREFERENCE_TEMPLATE_KEYS = [
  'taskAssigned',
  'taskClaimable',
  'taskReminder',
  'taskEscalated',
  'caseUnassigned',
  'caseCommented',
] as const;

const preferencePatchSchema = z.object({
  emailEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
});

// The notification centre: always the caller's own, scoped from the
// session rather than a route param, so there is no id to authorise
// against another user's inbox in the first place.
export function createNotificationsRouter(deps: NotificationsDeps): Router {
  const router = Router();

  router.use('/notifications', requireSession(deps.sessionSecret));

  router.get('/notifications', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const filter = parseBody(listQuerySchema, req.query);

      const page = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        findNotificationsForRecipient(trx, session.userId, {
          channel: 'inApp',
          unreadOnly: filter.unreadOnly === 'true',
          limit: filter.limit,
          cursor: filter.cursor,
        }),
      );

      res.status(200).json({
        data: page.notifications.map((notification) => ({
          notificationId: notification.notificationId,
          caseId: notification.caseId,
          taskId: notification.taskId,
          templateKey: notification.templateKey,
          subject: notification.subject,
          readAt: notification.readAt,
          createdAt: notification.createdAt,
        })),
        nextCursor: page.nextCursor,
        hasMore: page.hasMore,
      });
    } catch (err) {
      next(err);
    }
  });

  router.get('/notifications/unread-count', async (req, res, next) => {
    try {
      const session = sessionOf(req);

      const count = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        countUnreadNotifications(trx, session.userId),
      );

      res.status(200).json({ count });
    } catch (err) {
      next(err);
    }
  });

  // Self-service, like the rest of this router: always the caller's own
  // preferences, scoped from the session. Every template key is returned,
  // not only the ones this user has overridden, so the settings screen
  // never has to guess a default itself; absent means both channels on,
  // the same default workers/src/notifications/preferences.ts applies.
  router.get('/notifications/preferences', async (req, res, next) => {
    try {
      const session = sessionOf(req);

      const rows = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        findNotificationPreferencesForUser(trx, session.userId),
      );
      const byTemplate = new Map(rows.map((row) => [row.templateKey, row]));

      res.status(200).json({
        data: PREFERENCE_TEMPLATE_KEYS.map((templateKey) => ({
          templateKey,
          emailEnabled: byTemplate.get(templateKey)?.emailEnabled ?? true,
          inAppEnabled: byTemplate.get(templateKey)?.inAppEnabled ?? true,
        })),
      });
    } catch (err) {
      next(err);
    }
  });

  router.patch('/notifications/preferences/:templateKey', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const templateKey = req.params.templateKey!;
      if (!(PREFERENCE_TEMPLATE_KEYS as readonly string[]).includes(templateKey)) {
        throw new HttpProblemError(
          400,
          'Bad Request',
          `Unknown notification template '${templateKey}'.`,
        );
      }
      const body = parseBody(preferencePatchSchema, req.body);

      const updated = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        setNotificationPreference(trx, {
          organisationId: session.organisationId,
          userId: session.userId,
          templateKey,
          emailEnabled: body.emailEnabled,
          inAppEnabled: body.inAppEnabled,
        }),
      );

      res.status(200).json(updated);
    } catch (err) {
      next(err);
    }
  });

  router.post('/notifications/read-all', async (req, res, next) => {
    try {
      const session = sessionOf(req);

      await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        markAllNotificationsRead(trx, session.userId),
      );

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  router.post('/notifications/:notificationId/read', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const notificationId = req.params.notificationId!;

      // No 404 for an unknown or someone-else's id: markNotificationRead's
      // own WHERE clause already requires a match on recipient_user_id, so
      // a caller can learn nothing about whether a given id exists or
      // belongs to them from this response either way, and there is
      // nothing left to tell them beyond "your inbox is now consistent
      // with what you asked for."
      await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        markNotificationRead(trx, notificationId, session.userId),
      );

      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
