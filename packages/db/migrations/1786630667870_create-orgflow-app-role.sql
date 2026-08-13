-- Up Migration

-- Two roles, deliberately distinct. The migration role owns the tables; the
-- application never owns anything and assumes orgflow_app via SET LOCAL ROLE
-- inside every scoped transaction (ADR-0004, ADR-0009), never by connecting
-- as it directly, which NOLOGIN prevents in any case. This must be created
-- before any grant in a later migration references it.
CREATE ROLE orgflow_app NOLOGIN;

-- Whichever role runs this migration (the Docker Compose bootstrap user
-- locally; a real non-superuser role in a deployed environment) must be a
-- member of orgflow_app to SET ROLE to it without relying on superuser
-- privilege to bypass the membership check.
GRANT orgflow_app TO CURRENT_USER;

-- Down Migration

REVOKE orgflow_app FROM CURRENT_USER;
DROP ROLE orgflow_app;
