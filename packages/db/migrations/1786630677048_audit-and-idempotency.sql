-- Up Migration
-- Transcribed from PRD.md §2.5. The orgflow_app role itself is created in
-- the previous migration, before this one references it.

CREATE TABLE audit_events (
  audit_event_id      UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL,
  actor_user_id       UUID,
  actor_type          TEXT NOT NULL DEFAULT 'user'
                        CHECK (actor_type IN ('user','system','scheduler')),
  entity_type         TEXT NOT NULL,             -- 'case','task','definition','member', ...
  entity_id           UUID,
  action              TEXT NOT NULL,             -- 'case.submitted','task.approved', ...
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id      TEXT,
  ip_address          INET,
  user_agent          TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_org_entity ON audit_events (organisation_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_org_time   ON audit_events (organisation_id, occurred_at DESC);

-- Append-only, enforced by grants rather than convention.
REVOKE UPDATE, DELETE ON audit_events FROM orgflow_app;
GRANT  INSERT, SELECT  ON audit_events TO   orgflow_app;

CREATE TABLE idempotency_keys (
  idempotency_key     TEXT PRIMARY KEY,
  organisation_id     UUID,
  consumer            TEXT NOT NULL,
  result              JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL
);

-- PRD.md §2.5 does not show a grant for idempotency_keys; the application
-- needs to insert a placeholder row then update it with the result.
GRANT SELECT, INSERT, UPDATE ON idempotency_keys TO orgflow_app;

-- Down Migration

DROP TABLE idempotency_keys;
DROP TABLE audit_events;
