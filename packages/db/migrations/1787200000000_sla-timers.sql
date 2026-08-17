-- Up Migration
-- Transcribed from PRD.md §2.4. schedule_name exists for the real
-- EventBridge Scheduler implementation PRD.md §15.2 specifies (one-off
-- schedules per timer); nothing deployed to AWS reads it yet, so a local
-- process is free to store a synthetic identifier there instead, and the
-- column needs no change when that implementation arrives.

CREATE TABLE sla_timers (
  timer_id            UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  case_id             UUID NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  task_id             UUID REFERENCES case_tasks(task_id) ON DELETE CASCADE,
  schedule_name       TEXT NOT NULL,
  timer_type          TEXT NOT NULL
                        CHECK (timer_type IN ('reminder','escalation','expiry')),
  escalation_level    INTEGER NOT NULL DEFAULT 0,
  fire_at             TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','fired','cancelled')),
  fired_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The one query allowed to look across every tenant at once: a sweep has to
-- find due work across the whole database, not one organisation's slice of
-- it (packages/db/src/repositories/sla-timers.ts's findDueTimers). Every
-- row it returns still carries its own organisation_id, and every mutation
-- that follows happens inside that row's own tenant transaction.
CREATE INDEX idx_sla_timers_due ON sla_timers (fire_at) WHERE status = 'scheduled';
CREATE INDEX idx_sla_timers_task ON sla_timers (task_id) WHERE status = 'scheduled';

GRANT SELECT, INSERT, UPDATE ON sla_timers TO orgflow_app;

ALTER TABLE sla_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE sla_timers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sla_timers
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

-- Down Migration

DROP POLICY tenant_isolation ON sla_timers;
ALTER TABLE sla_timers NO FORCE ROW LEVEL SECURITY;
ALTER TABLE sla_timers DISABLE ROW LEVEL SECURITY;

REVOKE SELECT, INSERT, UPDATE ON sla_timers FROM orgflow_app;

DROP INDEX idx_sla_timers_task;
DROP INDEX idx_sla_timers_due;
DROP TABLE sla_timers;
