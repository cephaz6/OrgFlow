-- Up Migration
-- ADR-0026: a global platform-admin flag, gating organisation creation.
--
-- POST /organisations previously had no route at all, so the only way an
-- organisation ever came to exist was the dev-seed script inserting one
-- directly. PRD-SUMMARY.md §3 lists "self-serve creation" as in scope, but
-- the full PRD.md never actually specifies it: no schema, no role, no API
-- gate. Discussed and decided: creation is gated to a platform admin, a
-- concept genuinely above every organisation rather than scoped to one, so
-- it cannot live in organisation_members. users already carries no
-- organisation_id and has no RLS (PRD.md §2.1), so this is consistent with
-- how that table already behaves, not a new kind of exception.

ALTER TABLE users ADD COLUMN is_platform_admin BOOLEAN NOT NULL DEFAULT false;

-- Down Migration

ALTER TABLE users DROP COLUMN is_platform_admin;
