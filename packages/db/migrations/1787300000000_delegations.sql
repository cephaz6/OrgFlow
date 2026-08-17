-- Up Migration
-- Transcribed from PRD.md §2.5. PRD.md §7: "delegation is applied at
-- resolution time." An active delegation redirects a task the same way a
-- group key redirects to a group id, a database fact the pure engine
-- cannot look up itself (packages/core/src/engine/assignment.ts).

CREATE TABLE delegations (
  delegation_id       UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  from_user_id        UUID NOT NULL REFERENCES users(user_id),
  to_user_id          UUID NOT NULL REFERENCES users(user_id),
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  reason              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (from_user_id <> to_user_id)
);

-- findActiveDelegationsForOrg reads every currently-active delegation for
-- an organisation in one query, to build the
-- activeDelegateByUserId map the engine is handed.
CREATE INDEX idx_delegations_active
  ON delegations (organisation_id, from_user_id, starts_at, ends_at);

GRANT SELECT, INSERT, DELETE ON delegations TO orgflow_app;

ALTER TABLE delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delegations
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

-- Down Migration

DROP POLICY tenant_isolation ON delegations;
ALTER TABLE delegations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE delegations DISABLE ROW LEVEL SECURITY;

REVOKE SELECT, INSERT, DELETE ON delegations FROM orgflow_app;

DROP INDEX idx_delegations_active;
DROP TABLE delegations;
