import {
  countUnreadNotifications,
  findNotificationsForRecipient,
  markAllNotificationsRead,
  markNotificationRead,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { parseBody } from '../lib/parse-body.js';
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
