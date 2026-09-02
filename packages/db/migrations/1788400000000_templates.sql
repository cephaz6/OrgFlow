-- Up Migration
-- PRD.md §9: templates are non-runnable blueprints a process is cloned
-- from. Two tables rather than one, per ADR-0042.
--
-- `templates` is a tenant table like every other: organisation_id NOT NULL,
-- RLS on, isolated by the same policy. It holds the `organisation` and
-- `published` scopes, both of which are owned by exactly one organisation.
--
-- `system_templates` is OrgFlow's own catalogue (PRD.md §9.3's six). It
-- belongs to no tenant, so rather than a nullable organisation_id and an
-- RLS policy with a hole in it, it is a separate table of read-only
-- reference data, granted SELECT alone. CLAUDE.md §3's rule that every
-- query is scoped by organisation_id then survives intact: a table with no
-- tenant column cannot leak one tenant's data into another's, because it
-- never held any.
--
-- Both point at a Mongo document holding the blueprint, the same split
-- process_versions already uses for definition documents.

CREATE TABLE templates (
  template_id         UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  key                 TEXT NOT NULL,
  name                TEXT NOT NULL,
  description         TEXT,
  category            TEXT,
  icon                TEXT,
  -- No 'system' here: a row in this table always has an owning
  -- organisation, and the CHECK is what stops one being written.
  scope               TEXT NOT NULL DEFAULT 'organisation'
                        CHECK (scope IN ('organisation','published')),
  document_id         TEXT NOT NULL,
  created_by_user_id  UUID NOT NULL REFERENCES users(user_id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, key)
);

-- The catalogue lists an organisation's own templates newest first, and
-- separately lists every published template across all organisations.
CREATE INDEX idx_templates_organisation ON templates (organisation_id, created_at DESC);
CREATE INDEX idx_templates_published ON templates (created_at DESC) WHERE scope = 'published';

GRANT SELECT, INSERT, UPDATE, DELETE ON templates TO orgflow_app;

ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates FORCE ROW LEVEL SECURITY;

-- Deliberately two policies rather than one with an OR. Tenant isolation
-- is the rule; the published library is a named, auditable exception to it
-- that PRD.md §9.1 requires, and keeping them apart means the exception can
-- be read, reviewed and dropped without touching the rule.
CREATE POLICY tenant_isolation ON templates
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

-- Read-only, and only for rows their owner has explicitly opted into
-- sharing. FOR SELECT, so a published template still cannot be modified by
-- anyone but its owning organisation, which the policy above governs.
CREATE POLICY published_library_is_readable ON templates
  FOR SELECT
  USING (scope = 'published');

CREATE TABLE system_templates (
  template_id         UUID PRIMARY KEY,
  key                 TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL,
  description         TEXT,
  category            TEXT,
  icon                TEXT,
  document_id         TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- SELECT only: PRD.md §9.1 makes the system catalogue read-only to every
-- organisation, and the application role has no business writing it. Seeds
-- run as the migration owner, not as orgflow_app.
GRANT SELECT ON system_templates TO orgflow_app;

-- Down Migration

REVOKE SELECT ON system_templates FROM orgflow_app;
DROP TABLE system_templates;

DROP POLICY published_library_is_readable ON templates;
DROP POLICY tenant_isolation ON templates;
ALTER TABLE templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE templates DISABLE ROW LEVEL SECURITY;

REVOKE SELECT, INSERT, UPDATE, DELETE ON templates FROM orgflow_app;

DROP INDEX idx_templates_published;
DROP INDEX idx_templates_organisation;
DROP TABLE templates;
