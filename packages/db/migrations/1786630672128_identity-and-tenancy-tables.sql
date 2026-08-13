-- Up Migration
-- Transcribed from PRD.md §2.1. All identifiers snake_case, all primary
-- keys UUID v7 generated in the application layer (ADR-0003), all
-- timestamps TIMESTAMPTZ in UTC.

CREATE TABLE organisations (
  organisation_id     UUID PRIMARY KEY,
  name                TEXT NOT NULL,
  slug                TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','deleted')),
  branding            JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings            JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id  UUID NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  user_id             UUID PRIMARY KEY,
  email               TEXT NOT NULL UNIQUE,
  display_name        TEXT NOT NULL,
  avatar_url          TEXT,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','disabled')),
  last_login_at       TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Federated identities. A user may authenticate via several providers.
CREATE TABLE user_identities (
  user_identity_id    UUID PRIMARY KEY,
  user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  provider_id         UUID,                      -- NULL for the local dev provider
  subject             TEXT NOT NULL,             -- OIDC 'sub'
  issuer              TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject)
);

CREATE TABLE organisation_members (
  organisation_member_id UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  roles               TEXT[] NOT NULL DEFAULT ARRAY['member'],
  job_title           TEXT,
  department          TEXT,
  line_manager_user_id UUID REFERENCES users(user_id),
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','suspended','removed')),
  joined_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id)
);

CREATE TABLE invitations (
  invitation_id       UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  roles               TEXT[] NOT NULL DEFAULT ARRAY['member'],
  token_hash          TEXT NOT NULL,
  invited_by_user_id  UUID NOT NULL REFERENCES users(user_id),
  expires_at          TIMESTAMPTZ NOT NULL,
  accepted_at         TIMESTAMPTZ,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One outstanding invitation per email per organisation. This must be a partial
-- unique INDEX, not a table constraint: Postgres does not accept a WHERE clause
-- on UNIQUE. Accepted and revoked rows are excluded, so an address can be
-- re-invited after a previous invitation is resolved.
CREATE UNIQUE INDEX uq_invitations_pending
  ON invitations (organisation_id, email)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

CREATE TABLE identity_providers (
  provider_id         UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  type                TEXT NOT NULL CHECK (type IN ('oidc')),
  display_name        TEXT NOT NULL,
  issuer_url          TEXT NOT NULL,
  client_id           TEXT NOT NULL,
  client_secret_ref   TEXT NOT NULL,             -- Secrets Manager ARN, never the secret
  email_domains       TEXT[] NOT NULL DEFAULT '{}',
  enabled             BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  group_id            UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, name)
);

CREATE TABLE group_members (
  group_member_id     UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  group_id            UUID NOT NULL REFERENCES groups(group_id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

-- PRD.md §2.5 only shows explicit grants for audit_events; the application
-- needs ordinary CRUD on every other table it owns (see ADR-0009).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  organisations, users, user_identities, organisation_members,
  invitations, identity_providers, groups, group_members
TO orgflow_app;

-- Down Migration

REVOKE SELECT, INSERT, UPDATE, DELETE ON
  organisations, users, user_identities, organisation_members,
  invitations, identity_providers, groups, group_members
FROM orgflow_app;

DROP TABLE group_members;
DROP TABLE groups;
DROP TABLE identity_providers;
DROP INDEX uq_invitations_pending;
DROP TABLE invitations;
DROP TABLE organisation_members;
DROP TABLE user_identities;
DROP TABLE users;
DROP TABLE organisations;
