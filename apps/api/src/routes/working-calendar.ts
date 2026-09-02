import { DEFAULT_CALENDAR } from '@orgflow/core';
import {
  addHoliday,
  findOrganisationCalendar,
  removeHoliday,
  upsertOrganisationCalendar,
  withTenantTransaction,
  type Database,
} from '@orgflow/db';
import { Router } from 'express';
import type { Kysely } from 'kysely';
import { z } from 'zod';

import { isAdministrator } from '../cases/permissions.js';
import { parseBody } from '../lib/parse-body.js';
import { HttpProblemError } from '../middleware/error-handler.js';
import { requireSession, sessionOf } from '../middleware/require-session.js';

export interface WorkingCalendarDeps {
  db: Kysely<Database>;
  sessionSecret: string;
}

// Validated against the runtime's own tz database rather than a hard-coded
// list: the thing that has to understand the name is Intl, so the check is
// whether Intl understands it. A list in the schema would be stale within a
// year, since the IANA database gains and retires zones.
function isKnownTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const calendarSchema = z
  .object({
    timeZone: z.string().min(1).max(64).refine(isKnownTimeZone, {
      message: 'Unknown time zone.',
    }),
    workdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
  })
  .refine((value) => value.endMinute > value.startMinute, {
    message: 'The working day must end after it starts.',
    path: ['endMinute'],
  });

const holidaySchema = z.object({
  // The same shape the column's CHECK enforces, and the same shape the
  // engine compares against.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD.'),
  name: z.string().min(1).max(200),
});

export function createWorkingCalendarRouter(deps: WorkingCalendarDeps): Router {
  const router = Router();

  router.use('/working-calendar', requireSession(deps.sessionSecret));

  // Readable by any member, because a deadline computed from it is shown to
  // everybody and "why is this due Tuesday" is a fair question for the
  // person the task is assigned to, not only for an administrator.
  router.get('/working-calendar', async (req, res, next) => {
    try {
      const session = sessionOf(req);

      const configured = await withTenantTransaction(deps.db, session.organisationId, (trx) =>
        findOrganisationCalendar(trx),
      );

      res.status(200).json({
        // Which of the two it is matters to the settings screen: "nobody has
        // set this" reads differently from "somebody set it to exactly the
        // default", even though the numbers are identical.
        isDefault: configured === null,
        calendar: configured ?? { ...DEFAULT_CALENDAR, holidays: [] },
      });
    } catch (err) {
      next(err);
    }
  });

  // PRD.md §12.2 puts organisation configuration with admin and above.
  router.put('/working-calendar', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const body = parseBody(calendarSchema, req.body);

      await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Changing the working calendar requires the admin or owner role.',
          );
        }

        await upsertOrganisationCalendar(trx, {
          organisationId: session.organisationId,
          ...body,
        });
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  router.post('/working-calendar/holidays', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const body = parseBody(holidaySchema, req.body);

      const holidayId = await withTenantTransaction(
        deps.db,
        session.organisationId,
        async (trx) => {
          if (!(await isAdministrator(trx, session))) {
            throw new HttpProblemError(
              403,
              'Forbidden',
              'Changing the working calendar requires the admin or owner role.',
            );
          }

          return addHoliday(trx, {
            organisationId: session.organisationId,
            date: body.date,
            name: body.name,
          });
        },
      );

      res.status(201).json({ holiday: { holidayId, date: body.date, name: body.name } });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/working-calendar/holidays/:holidayId', async (req, res, next) => {
    try {
      const session = sessionOf(req);
      const holidayId = req.params.holidayId!;

      await withTenantTransaction(deps.db, session.organisationId, async (trx) => {
        if (!(await isAdministrator(trx, session))) {
          throw new HttpProblemError(
            403,
            'Forbidden',
            'Changing the working calendar requires the admin or owner role.',
          );
        }

        const removed = await removeHoliday(trx, holidayId);
        if (!removed) {
          // Another tenant's holiday is invisible under RLS, so this is the
          // same 404 a genuinely missing one gets (CLAUDE.md §3).
          throw new HttpProblemError(404, 'Not Found', 'No such holiday.');
        }
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
