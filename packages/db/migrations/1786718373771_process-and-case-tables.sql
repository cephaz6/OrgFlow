-- Up Migration
-- Transcribed from PRD.md §2.2 (process definitions) and §2.3 (cases and
-- tasks). case_comments is included because §2.3 defines it alongside the
-- others and the case timeline reads it; attachments, notifications and
-- timers are deliberately left to their own later phases.

CREATE TABLE process_definitions (
  definition_id       UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  key                 TEXT NOT NULL,             -- stable slug, e.g. 'laptop-request'
  name                TEXT NOT NULL,
  description         TEXT,
  category            TEXT,
  icon                TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','published','archived')),
  current_version_id  UUID,                      -- FK added after process_versions
  reference_prefix    TEXT NOT NULL,             -- e.g. 'LAP' -> LAP-000123
  reference_counter   BIGINT NOT NULL DEFAULT 0,
  retention_days      INTEGER,                   -- NULL = retain indefinitely
  created_by_user_id  UUID NOT NULL REFERENCES users(user_id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, key)
);

CREATE TABLE process_versions (
  version_id          UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  definition_id       UUID NOT NULL REFERENCES process_definitions(definition_id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL,
  document_id         TEXT NOT NULL,             -- Mongo _id of the definition document
  document_hash       TEXT NOT NULL,             -- SHA-256, integrity check
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','published','archived')),
  change_note         TEXT,
  published_by_user_id UUID REFERENCES users(user_id),
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (definition_id, version_number)
);

ALTER TABLE process_definitions
  ADD CONSTRAINT fk_current_version
  FOREIGN KEY (current_version_id) REFERENCES process_versions(version_id);

CREATE TABLE cases (
  case_id             UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  definition_id       UUID NOT NULL REFERENCES process_definitions(definition_id),
  version_id          UUID NOT NULL REFERENCES process_versions(version_id),  -- THE PIN
  reference           TEXT NOT NULL,             -- 'LAP-000123'
  title               TEXT NOT NULL,             -- derived from a designated form field
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','active','completed','rejected','cancelled','unassigned')),
  outcome             TEXT CHECK (outcome IN ('approved','rejected','cancelled','withdrawn')),
  current_step_key    TEXT,
  values_document_id  TEXT,                      -- Mongo _id of submitted values
  submitted_by_user_id UUID NOT NULL REFERENCES users(user_id),
  submitted_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  due_at              TIMESTAMPTZ,               -- overall case SLA
  row_version         INTEGER NOT NULL DEFAULT 1, -- optimistic concurrency
  redacted_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, reference)
);

CREATE INDEX idx_cases_org_status      ON cases (organisation_id, status);
CREATE INDEX idx_cases_org_submitter   ON cases (organisation_id, submitted_by_user_id, created_at DESC);
CREATE INDEX idx_cases_org_definition  ON cases (organisation_id, definition_id, created_at DESC);

CREATE TABLE case_tasks (
  task_id             UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  case_id             UUID NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  step_key            TEXT NOT NULL,
  step_name           TEXT NOT NULL,             -- snapshot: version may later be archived
  task_type           TEXT NOT NULL
                        CHECK (task_type IN ('approval','action','acknowledgement')),
  assignment_strategy TEXT NOT NULL,
  assignee_user_id    UUID REFERENCES users(user_id),
  assignee_group_id   UUID REFERENCES groups(group_id),
  assignee_role       TEXT,
  delegated_from_user_id UUID REFERENCES users(user_id),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','claimed','completed','skipped','reassigned','cancelled','expired')),
  decision            TEXT CHECK (decision IN ('approved','rejected','returned','completed')),
  comment             TEXT,
  due_at              TIMESTAMPTZ,
  escalation_level    INTEGER NOT NULL DEFAULT 0,
  escalated_at        TIMESTAMPTZ,
  claimed_by_user_id  UUID REFERENCES users(user_id),
  claimed_at          TIMESTAMPTZ,
  completed_by_user_id UUID REFERENCES users(user_id),
  completed_at        TIMESTAMPTZ,
  row_version         INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_assignee_pending
  ON case_tasks (organisation_id, assignee_user_id, status, due_at)
  WHERE status IN ('pending','claimed');
CREATE INDEX idx_tasks_case ON case_tasks (case_id, created_at);
CREATE INDEX idx_tasks_overdue
  ON case_tasks (due_at) WHERE status IN ('pending','claimed');

CREATE TABLE case_transitions (
  transition_id       UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  case_id             UUID NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  from_step_key       TEXT,
  to_step_key         TEXT,
  trigger_type        TEXT NOT NULL
                        CHECK (trigger_type IN ('submission','decision','escalation','timer','system','admin')),
  triggered_by_user_id UUID REFERENCES users(user_id),
  task_id             UUID REFERENCES case_tasks(task_id),
  condition_result    JSONB,                     -- which branch was taken and why
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transitions_case ON case_transitions (case_id, occurred_at);

CREATE TABLE case_comments (
  comment_id          UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  case_id             UUID NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  author_user_id      UUID NOT NULL REFERENCES users(user_id),
  body                TEXT NOT NULL,
  visibility          TEXT NOT NULL DEFAULT 'all'
                        CHECK (visibility IN ('all','approvers')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same reasoning as the identity and tenancy migration: the application
-- needs ordinary CRUD on every table it owns (ADR-0009). case_transitions
-- is a history table like audit_events, so it gets INSERT and SELECT only:
-- a recorded transition is a statement about something that happened, and
-- rewriting one would make the case timeline a lie.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  process_definitions, process_versions, cases, case_tasks, case_comments
TO orgflow_app;

GRANT SELECT, INSERT ON case_transitions TO orgflow_app;

-- PRD.md §2.6: RLS on every tenant table. Same policy predicate as the
-- existing tables; see the row-level-security migration for why
-- current_setting's missing_ok argument matters.

ALTER TABLE process_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_definitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON process_definitions
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

ALTER TABLE process_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE process_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON process_versions
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cases
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

ALTER TABLE case_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_tasks
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

ALTER TABLE case_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_transitions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_transitions
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

ALTER TABLE case_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE case_comments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON case_comments
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

-- Down Migration

DROP POLICY tenant_isolation ON case_comments;
ALTER TABLE case_comments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE case_comments DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_isolation ON case_transitions;
ALTER TABLE case_transitions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE case_transitions DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_isolation ON case_tasks;
ALTER TABLE case_tasks NO FORCE ROW LEVEL SECURITY;
ALTER TABLE case_tasks DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_isolation ON cases;
ALTER TABLE cases NO FORCE ROW LEVEL SECURITY;
ALTER TABLE cases DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_isolation ON process_versions;
ALTER TABLE process_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE process_versions DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_isolation ON process_definitions;
ALTER TABLE process_definitions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE process_definitions DISABLE ROW LEVEL SECURITY;

REVOKE SELECT, INSERT ON case_transitions FROM orgflow_app;

REVOKE SELECT, INSERT, UPDATE, DELETE ON
  process_definitions, process_versions, cases, case_tasks, case_comments
FROM orgflow_app;

DROP TABLE case_comments;
DROP TABLE case_transitions;
DROP TABLE case_tasks;
DROP TABLE cases;
ALTER TABLE process_definitions DROP CONSTRAINT fk_current_version;
DROP TABLE process_versions;
DROP TABLE process_definitions;
