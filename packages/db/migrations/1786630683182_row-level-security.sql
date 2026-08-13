-- Up Migration
-- Transcribed from PRD.md §2.6, applied to every table from the previous two
-- migrations that carries organisation_id as a tenant-scoping column.
-- organisations, users and user_identities are excluded: organisations is
-- the tenant root (its own primary key, not a scoping column), and users /
-- user_identities are global, not organisation-scoped.
--
-- The second argument to current_setting is missing_ok. Without it, the
-- function raises when the setting is absent, so every connection that has
-- not yet set a tenant errors on every query, including the migration
-- runner and the readiness check. With it, an unset tenant yields NULL, the
-- comparison yields NULL, and the policy denies the row: failing closed.
--
-- The application sets orgflow.organisation_id per transaction, with
-- SET LOCAL, alongside SET LOCAL ROLE orgflow_app (ADR-0004, ADR-0009).

ALTER TABLE organisation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organisation_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON organisation_members
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitations
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

ALTER TABLE identity_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_providers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON identity_providers
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON groups
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON group_members
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_events
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON idempotency_keys
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

-- Down Migration

DROP POLICY tenant_isolation ON idempotency_keys;
ALTER TABLE idempotency_keys NO FORCE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_isolation ON audit_events;
ALTER TABLE audit_events NO FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_isolation ON group_members;
ALTER TABLE group_members NO FORCE ROW LEVEL SECURITY;
ALTER TABLE group_members DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_isolation ON groups;
ALTER TABLE groups NO FORCE ROW LEVEL SECURITY;
ALTER TABLE groups DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_isolation ON identity_providers;
ALTER TABLE identity_providers NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_providers DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_isolation ON invitations;
ALTER TABLE invitations NO FORCE ROW LEVEL SECURITY;
ALTER TABLE invitations DISABLE ROW LEVEL SECURITY;

DROP POLICY tenant_isolation ON organisation_members;
ALTER TABLE organisation_members NO FORCE ROW LEVEL SECURITY;
ALTER TABLE organisation_members DISABLE ROW LEVEL SECURITY;
