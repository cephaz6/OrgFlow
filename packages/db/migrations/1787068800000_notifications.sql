-- Up Migration
-- Transcribed from PRD.md §2.4. Only the notifications table itself: the
-- attachments and timers defined alongside it belong to Phase 7 and Phase 6
-- respectively, and notification_preferences is not needed until per-user
-- preferences exist (PRD.md §14.2), which nothing yet reads or writes.

CREATE TABLE notifications (
  notification_id     UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  recipient_user_id   UUID NOT NULL REFERENCES users(user_id),
  case_id             UUID REFERENCES cases(case_id) ON DELETE CASCADE,
  task_id             UUID REFERENCES case_tasks(task_id) ON DELETE CASCADE,
  channel             TEXT NOT NULL CHECK (channel IN ('email','inApp')),
  template_key        TEXT NOT NULL,
  subject             TEXT,
  status              TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sent','delivered','failed','suppressed')),
  read_at             TIMESTAMPTZ,
  sent_at             TIMESTAMPTZ,
  failure_reason      TEXT,
  -- PRD.md §14.2: delivery is idempotent, keyed on eventId plus
  -- recipientUserId plus templateKey. The UNIQUE constraint is what makes
  -- that true under redelivery rather than merely intended: SQS is
  -- at-least-once, so a consumer that only checked before inserting would
  -- still double-send under a concurrent redelivery.
  idempotency_key     TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient_unread
  ON notifications (organisation_id, recipient_user_id, created_at DESC)
  WHERE read_at IS NULL AND channel = 'inApp';

GRANT SELECT, INSERT, UPDATE, DELETE ON notifications TO orgflow_app;

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );

-- Down Migration

DROP POLICY tenant_isolation ON notifications;
ALTER TABLE notifications NO FORCE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;

REVOKE SELECT, INSERT, UPDATE, DELETE ON notifications FROM orgflow_app;

DROP INDEX idx_notifications_recipient_unread;
DROP TABLE notifications;
