-- Up Migration
-- ADR-0014 gave groups a stable `key` for the same reason
-- process_definitions already has one: a display name should be free to
-- change (or collide) without breaking what a pinned definition document
-- resolves against. process_definitions enforces uniqueness on
-- (organisation_id, key) alone, with no separate name constraint.
--
-- groups' own original (organisation_id, name) constraint, from before
-- `key` existed, was never dropped when group-keys.sql added the new one.
-- Left in place, it means two groups still cannot share a display name:
-- an admin renaming "Legal" and later creating a fresh "Legal" hits a name
-- collision the key design was meant to make unnecessary, discovered
-- while building the groups management UI's own create flow (which
-- allocates a suffixed key, e.g. 'legal-2', exactly the way
-- allocateDefinitionKey already does for process definitions).

ALTER TABLE groups DROP CONSTRAINT groups_organisation_id_name_key;

-- Down Migration

ALTER TABLE groups ADD CONSTRAINT groups_organisation_id_name_key UNIQUE (organisation_id, name);
