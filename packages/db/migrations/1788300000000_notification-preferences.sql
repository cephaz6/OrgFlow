-- Up Migration
-- Self-service notification control: every notification currently fires
-- on both channels (email and in-app) unconditionally, with nothing a
-- member can adjust for themselves.
--
-- One row per (organisation, user, template) that somebody has actually
-- overridden, not one row per possible combination up front: absence of a
-- row means both channels stay enabled, which is exactly today's
-- behaviour, so nobody's notifications change the moment this migration
-- runs. workers/src/notifications/preferences.ts is what applies that
-- default.

CREATE TABLE notification_preferences (
  preference_id       UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  template_key        TEXT NOT NULL,
  email_enabled       BOOLEAN NOT NULL DEFAULT true,
  in_app_enabled      BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id, template_key)
);

GRANT SELECT, INSERT, UPDATE ON notification_preferences TO orgflow_app;

ALTER TABLE notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_preferences
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

-- Down Migration

DROP POLICY tenant_isolation ON notification_preferences;
ALTER TABLE notification_preferences NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notification_preferences DISABLE ROW LEVEL SECURITY;

REVOKE SELECT, INSERT, UPDATE ON notification_preferences FROM orgflow_app;

DROP TABLE notification_preferences;
