-- Up Migration
-- PRD.md §11.7: DELETE /attachments/:id is a soft delete, not a row removal
-- (the original migration's own comment on the table already rules out a
-- hard DELETE, for retention/redaction reasons). A confirmed upload can be
-- referenced by decisions already made against it, so removing it needs to
-- stop it being served and counted, not erase that it ever existed.

ALTER TABLE attachments ADD COLUMN deleted_at TIMESTAMPTZ;

-- Down Migration

ALTER TABLE attachments DROP COLUMN deleted_at;
