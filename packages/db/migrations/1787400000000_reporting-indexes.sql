-- Up Migration
-- Phase 8 reporting. cases already has idx_cases_org_status,
-- idx_cases_org_submitter and idx_cases_org_definition, but nothing usable
-- for a range scan on submitted_at or completed_at, and every report query
-- in this phase filters and sorts by one of them. Partial indexes: neither
-- column is set on a draft case, so the null rows would only add bulk.

CREATE INDEX idx_cases_org_submitted_at ON cases (organisation_id, submitted_at)
  WHERE submitted_at IS NOT NULL;

CREATE INDEX idx_cases_org_completed_at ON cases (organisation_id, completed_at)
  WHERE completed_at IS NOT NULL;

-- Down Migration

DROP INDEX idx_cases_org_completed_at;
DROP INDEX idx_cases_org_submitted_at;
