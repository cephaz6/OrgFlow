-- Up Migration
-- PRD.md §16: an attachment is a case-scoped upload against one `file`
-- field. Postgres holds this table as the sole source of truth for its
-- storage location and scan status; the Mongo case document only ever
-- holds the attachment id as a thin reference (never filename, size or
-- scan status), so nothing can disagree about mutable state the way it
-- would if that state were duplicated into an otherwise immutable
-- document snapshot.

CREATE TABLE attachments (
  attachment_id        UUID PRIMARY KEY,
  organisation_id      UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  case_id              UUID NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  field_key            TEXT NOT NULL,
  filename             TEXT NOT NULL,
  declared_mime_type   TEXT NOT NULL,
  -- Filled by the scan Lambda after content-sniffing the uploaded bytes
  -- (GOV-STANDARDS.md §6.4: never trust the client-declared header or the
  -- file extension). Null until scanned.
  sniffed_mime_type    TEXT,
  size_bytes           BIGINT NOT NULL,
  -- {organisationId}/cases/{caseId}/{attachmentId}/{filename}, per
  -- TECH-STACK.md §5.3.
  storage_key          TEXT NOT NULL,
  scan_status          TEXT NOT NULL DEFAULT 'pending',
  uploaded_by_user_id  UUID NOT NULL REFERENCES users(user_id),
  -- Set by POST /attachments/:id/confirm once the client has finished
  -- uploading to S3 and the API has verified the object exists. Null
  -- until then; a row with no confirmation is an abandoned upload
  -- attempt, not something the scan pipeline ever sees.
  confirmed_at         TIMESTAMPTZ,
  scanned_at           TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (scan_status IN ('pending', 'clean', 'infected', 'error'))
);

-- The case-detail view's "attachments on this case" read, and
-- countConfirmedAttachmentsForField's maxFiles check (the second is why
-- field_key is part of the index rather than a separate one: it is
-- always queried alongside case_id, never on its own).
CREATE INDEX idx_attachments_case_field
  ON attachments (organisation_id, case_id, field_key);

-- No DELETE: retention-driven redaction (PRD.md §18) is an explicit
-- future hook, not built by this migration. Nothing in the attachment
-- pipeline itself ever removes a row.
GRANT SELECT, INSERT, UPDATE ON attachments TO orgflow_app;

ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON attachments
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

-- Down Migration

DROP POLICY tenant_isolation ON attachments;
ALTER TABLE attachments NO FORCE ROW LEVEL SECURITY;
ALTER TABLE attachments DISABLE ROW LEVEL SECURITY;

REVOKE SELECT, INSERT, UPDATE ON attachments FROM orgflow_app;

DROP INDEX idx_attachments_case_field;
DROP TABLE attachments;
