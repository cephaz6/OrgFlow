-- Up Migration
-- PRD.md §15.1's working calendar, per ADR-0044: the organisation
-- configuration a business-hours SLA is measured against. Until now every
-- deadline used the engine's UTC weekday default because there was nowhere
-- to say otherwise.
--
-- One row per organisation, so the primary key is the tenant id itself:
-- an organisation has one working week, not a list of them. Absence of a
-- row means the default, which is why nothing is backfilled here.

CREATE TABLE organisation_calendars (
  organisation_id     UUID PRIMARY KEY REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  -- IANA name. Not constrained to a list: the tz database gains and retires
  -- names, and a CHECK here would be stale within a year. The API validates
  -- against the runtime's own Intl support, which is the thing that has to
  -- understand it.
  time_zone           TEXT NOT NULL DEFAULT 'UTC',
  -- 0 = Sunday through 6 = Saturday. An array rather than seven booleans,
  -- because the engine takes it as a list and a shape that needs
  -- reassembling on every read invites the two to disagree.
  workdays            SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5}',
  -- Minutes from midnight, local to time_zone. 09:00 is 540, 17:00 is 1020.
  start_minute        INTEGER NOT NULL DEFAULT 540
                        CHECK (start_minute >= 0 AND start_minute < 1440),
  end_minute          INTEGER NOT NULL DEFAULT 1020
                        CHECK (end_minute > 0 AND end_minute <= 1440),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A working day with no length can never consume an SLA hour. The engine
  -- returns null rather than looping if it sees one, but the database is
  -- where it should be impossible in the first place.
  CONSTRAINT working_day_has_length CHECK (end_minute > start_minute),
  CONSTRAINT at_least_one_workday CHECK (cardinality(workdays) > 0)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON organisation_calendars TO orgflow_app;

ALTER TABLE organisation_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_calendars FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organisation_calendars
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

CREATE TABLE organisation_holidays (
  holiday_id          UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  -- TEXT, not DATE, and deliberately. A holiday is a date somebody wrote on
  -- a wall planner, not an instant, and node-postgres parses a DATE column
  -- into a JS Date at *local* midnight, which in a negative-offset timezone
  -- reads back as the previous day. Storing the ISO string keeps the value
  -- that was entered, which is also exactly what WorkingCalendar wants.
  holiday_date        TEXT NOT NULL CHECK (holiday_date ~ '^\d{4}-\d{2}-\d{2}$'),
  name                TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, holiday_date)
);

CREATE INDEX idx_organisation_holidays_lookup
  ON organisation_holidays (organisation_id, holiday_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON organisation_holidays TO orgflow_app;

ALTER TABLE organisation_holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_holidays FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organisation_holidays
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

-- Down Migration

DROP POLICY tenant_isolation ON organisation_holidays;
ALTER TABLE organisation_holidays NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organisation_holidays DISABLE ROW LEVEL SECURITY;
REVOKE SELECT, INSERT, UPDATE, DELETE ON organisation_holidays FROM orgflow_app;
DROP INDEX idx_organisation_holidays_lookup;
DROP TABLE organisation_holidays;

DROP POLICY tenant_isolation ON organisation_calendars;
ALTER TABLE organisation_calendars NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organisation_calendars DISABLE ROW LEVEL SECURITY;
REVOKE SELECT, INSERT, UPDATE, DELETE ON organisation_calendars FROM orgflow_app;
DROP TABLE organisation_calendars;
