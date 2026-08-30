-- Up Migration
-- The one-click "Approve" link a taskAssigned email carries alongside its
-- usual link to the app (docs/decisions.md's notify-on-comment/notification-
-- centre entries, this is the third of the same follow-up series).
-- Single-use and short-lived by design: a leaked or forwarded email should
-- not become a standing way to approve things. Modelled directly on
-- invitations' own token_hash/expires_at shape (identity-and-tenancy-tables
-- migration), never storing the raw token, only its SHA-256 hash.

CREATE TABLE task_decision_tokens (
  token_id            UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  task_id             UUID NOT NULL REFERENCES case_tasks(task_id) ON DELETE CASCADE,
  recipient_user_id   UUID NOT NULL REFERENCES users(user_id),
  token_hash          TEXT NOT NULL,
  expires_at          TIMESTAMPTZ NOT NULL,
  used_at             TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The unauthenticated lookup this table exists for: found by its hash
-- alone, before any organisation is known (the same bootstrapping shape
-- ADR-0011 already covers for invitations and identity provider lookup).
CREATE UNIQUE INDEX uq_task_decision_tokens_hash ON task_decision_tokens (token_hash);

GRANT SELECT, INSERT, UPDATE ON task_decision_tokens TO orgflow_app;

ALTER TABLE task_decision_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_decision_tokens FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_decision_tokens
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

-- Down Migration

DROP POLICY tenant_isolation ON task_decision_tokens;
ALTER TABLE task_decision_tokens NO FORCE ROW LEVEL SECURITY;
ALTER TABLE task_decision_tokens DISABLE ROW LEVEL SECURITY;

REVOKE SELECT, INSERT, UPDATE ON task_decision_tokens FROM orgflow_app;

DROP INDEX uq_task_decision_tokens_hash;
DROP TABLE task_decision_tokens;
