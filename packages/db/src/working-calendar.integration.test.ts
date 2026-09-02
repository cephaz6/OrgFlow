import type { WorkingCalendar } from '@orgflow/types';
import type { Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb } from './connection.js';
import { createOrganisation } from './repositories/organisations.js';
import { createUserWithIdentity } from './repositories/users.js';
import {
  addHoliday,
  findOrganisationCalendar,
  removeHoliday,
  resolveWorkingCalendar,
  upsertOrganisationCalendar,
} from './repositories/working-calendar.js';
import type { Database } from './schema.js';
import { withTenantTransaction } from './tenant-transaction.js';
import { generateId } from './uuid.js';

// packages/db does not depend on packages/core, and adding a dependency to
// assert engine arithmetic here would be the wrong direction of reach: this
// file is about what round-trips through Postgres. The deadline the stored
// calendar actually produces is asserted in apps/api's own integration
// test, where the engine already lives. This mirrors core's DEFAULT_CALENDAR
// only as the fallback value the repository is handed.
const DEFAULT_CALENDAR: WorkingCalendar = {
  timeZone: 'UTC',
  workdays: [1, 2, 3, 4, 5],
  startMinute: 540,
  endMinute: 1020,
  holidays: [],
};

// ADR-0044. The point of these is the round trip: a calendar written here
// has to come back in the shape the engine takes, and it has to be
// invisible to any other tenant.
describe('the working calendar', () => {
  let db: Kysely<Database>;
  let alpha: string;
  let beta: string;

  async function seedTenant(label: string) {
    const user = await createUserWithIdentity(db, {
      email: `${label}-${generateId()}@example.invalid`,
      displayName: label,
      issuer: 'urn:orgflow:test',
      subject: `${label}-${generateId()}`,
    });
    const organisation = await createOrganisation(db, {
      name: `${label} tenant`,
      slug: `${label}-${generateId()}`,
      createdByUserId: user.userId,
    });
    return { organisationId: organisation.organisationId, userId: user.userId };
  }

  beforeAll(async () => {
    db = createDb({ connectionString: process.env.ORGFLOW_TEST_DATABASE_URL! });
    const a = await seedTenant('cal-alpha');
    const b = await seedTenant('cal-beta');
    alpha = a.organisationId;
    beta = b.organisationId;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('reports no calendar until one is configured', async () => {
    const found = await withTenantTransaction(db, beta, (trx) => findOrganisationCalendar(trx));
    expect(found).toBeNull();
  });

  it('falls back to the engine default, so an unconfigured tenant still gets a deadline', async () => {
    const calendar = await withTenantTransaction(db, beta, (trx) =>
      resolveWorkingCalendar(trx, DEFAULT_CALENDAR),
    );
    expect(calendar.timeZone).toBe('UTC');
    expect(calendar.workdays).toEqual([1, 2, 3, 4, 5]);
    expect(calendar.holidays).toEqual([]);
  });

  it('round-trips a configured calendar in the shape the engine takes', async () => {
    await withTenantTransaction(db, alpha, (trx) =>
      upsertOrganisationCalendar(trx, {
        organisationId: alpha,
        timeZone: 'Europe/London',
        workdays: [1, 2, 3, 4],
        startMinute: 600,
        endMinute: 960,
      }),
    );

    const calendar = await withTenantTransaction(db, alpha, (trx) =>
      resolveWorkingCalendar(trx, DEFAULT_CALENDAR),
    );

    expect(calendar).toEqual({
      timeZone: 'Europe/London',
      workdays: [1, 2, 3, 4],
      startMinute: 600,
      endMinute: 960,
      holidays: [],
    });
  });

  it('updates in place rather than accumulating rows', async () => {
    await withTenantTransaction(db, alpha, (trx) =>
      upsertOrganisationCalendar(trx, {
        organisationId: alpha,
        timeZone: 'Europe/Paris',
        workdays: [1, 2, 3, 4, 5],
        startMinute: 540,
        endMinute: 1020,
      }),
    );

    const found = await withTenantTransaction(db, alpha, (trx) => findOrganisationCalendar(trx));
    expect(found?.timeZone).toBe('Europe/Paris');

    const rows = await db
      .selectFrom('organisation_calendars')
      .select('organisation_id')
      .where('organisation_id', '=', alpha)
      .execute();
    expect(rows).toHaveLength(1);
  });

  it('keeps a holiday as the date it was entered, not shifted by a timezone', async () => {
    // The reason holiday_date is TEXT: a DATE column comes back from
    // node-postgres as a JS Date at local midnight, which can read back as
    // the day before.
    await withTenantTransaction(db, alpha, (trx) =>
      addHoliday(trx, { organisationId: alpha, date: '2026-12-25', name: 'Christmas Day' }),
    );

    const calendar = await withTenantTransaction(db, alpha, (trx) =>
      resolveWorkingCalendar(trx, DEFAULT_CALENDAR),
    );
    expect(calendar.holidays).toContain('2026-12-25');
  });

  it('renames rather than failing when the same date is added twice', async () => {
    await withTenantTransaction(db, alpha, (trx) =>
      addHoliday(trx, { organisationId: alpha, date: '2026-12-26', name: 'Boxing day' }),
    );
    await withTenantTransaction(db, alpha, (trx) =>
      addHoliday(trx, { organisationId: alpha, date: '2026-12-26', name: 'Boxing Day' }),
    );

    const found = await withTenantTransaction(db, alpha, (trx) => findOrganisationCalendar(trx));
    const boxingDays = found?.holidays.filter((holiday) => holiday.date === '2026-12-26') ?? [];
    expect(boxingDays).toHaveLength(1);
    expect(boxingDays[0]?.name).toBe('Boxing Day');
  });

  it('applies holidays even when the working week itself is left at the default', async () => {
    // An organisation that only adds bank holidays should still get them,
    // rather than having them ignored for want of a calendar row.
    await withTenantTransaction(db, beta, (trx) =>
      addHoliday(trx, { organisationId: beta, date: '2027-01-01', name: 'New Year' }),
    );

    const calendar = await withTenantTransaction(db, beta, (trx) =>
      resolveWorkingCalendar(trx, DEFAULT_CALENDAR),
    );
    expect(calendar.timeZone).toBe('UTC');
    expect(calendar.holidays).toEqual(['2027-01-01']);
  });

  it('hides one tenant’s calendar and holidays from another', async () => {
    const fromBeta = await withTenantTransaction(db, beta, (trx) => findOrganisationCalendar(trx));
    // Beta has holidays of its own but never configured a working week, so
    // it still sees no calendar even though alpha has one.
    expect(fromBeta).toBeNull();

    const betaCalendar = await withTenantTransaction(db, beta, (trx) =>
      resolveWorkingCalendar(trx, DEFAULT_CALENDAR),
    );
    expect(betaCalendar.holidays).not.toContain('2026-12-25');
  });

  it('refuses to remove another tenant’s holiday', async () => {
    const alphaHolidays = await withTenantTransaction(db, alpha, (trx) =>
      findOrganisationCalendar(trx),
    );
    const target = alphaHolidays!.holidays[0]!;

    const removedByOther = await withTenantTransaction(db, beta, (trx) =>
      removeHoliday(trx, target.holidayId),
    );
    expect(removedByOther).toBe(false);

    const removedByOwner = await withTenantTransaction(db, alpha, (trx) =>
      removeHoliday(trx, target.holidayId),
    );
    expect(removedByOwner).toBe(true);
  });
});
