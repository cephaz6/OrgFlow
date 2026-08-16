-- Up Migration
-- ADR-0014: groups gain a stable key alongside their display name.
--
-- PRD.md §4's definition document assigns a step with
-- { strategy: 'group', groupKey: 'itSupport' }, but §2's groups table
-- offers only `name`, unique per organisation. Resolving groupKey against
-- a display name would mean renaming a group silently breaks every pinned
-- definition version referencing it, which §8 treats as the product's most
-- important correctness property. process_definitions in this same schema
-- already carries both a stable `key` and a display `name`; groups now
-- match that convention.

ALTER TABLE groups ADD COLUMN key TEXT;

-- Backfill before the NOT NULL: any group created before this migration
-- has only its name to derive a key from, and the name is already unique
-- per organisation, so it is a valid key even if it is not a tidy slug.
UPDATE groups SET key = name WHERE key IS NULL;

ALTER TABLE groups ALTER COLUMN key SET NOT NULL;
ALTER TABLE groups ADD CONSTRAINT uq_groups_organisation_key UNIQUE (organisation_id, key);

-- Down Migration

ALTER TABLE groups DROP CONSTRAINT uq_groups_organisation_key;
ALTER TABLE groups DROP COLUMN key;
