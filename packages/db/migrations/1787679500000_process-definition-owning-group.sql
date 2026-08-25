-- Up Migration
-- ADR-0026: process definitions gain an optional owning group.
--
-- Supersedes ADR-0015's ownership rule in part: "process owner of the
-- definition" was defined narrowly as holding the processOwner role and
-- created_by_user_id matching, with no ownership table or column, and that
-- ADR's own text names the situation this migration is for: "if this
-- proves too narrow, the fix is a proper ownership column or table, and
-- this ADR is superseded rather than the check quietly widened." A
-- worked example (one organisation with internal sub-units, each managing
-- its own templates) is exactly that situation. Nullable and additive: a
-- definition with no owning group behaves exactly as before this
-- migration, ADR-0015's rule unchanged.

ALTER TABLE process_definitions
  ADD COLUMN owning_group_id UUID REFERENCES groups(group_id);

-- Down Migration

ALTER TABLE process_definitions DROP COLUMN owning_group_id;
