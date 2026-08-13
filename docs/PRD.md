# OrgFlow: Product Requirements Document

**Version:** 1.0
**Status:** Baseline for implementation
**Companion documents:** `PROBLEM-STATEMENT.md`, `GOV-STANDARDS.md`, `TECH-STACK.md`, `PRD-SUMMARY.md`

---

## Contents

1. [Domain model](#1-domain-model)
2. [PostgreSQL schema](#2-postgresql-schema)
3. [MongoDB schema](#3-mongodb-schema)
4. [The definition document](#4-the-definition-document)
5. [The condition expression language](#5-the-condition-expression-language)
6. [The workflow engine](#6-the-workflow-engine)
7. [Assignment resolution](#7-assignment-resolution)
8. [Versioning rules](#8-versioning-rules)
9. [Templates](#9-templates)
10. [Event catalogue](#10-event-catalogue)
11. [API surface](#11-api-surface)
12. [Authentication and authorisation](#12-authentication-and-authorisation)
13. [Screens](#13-screens)
14. [Notifications](#14-notifications)
15. [SLA and escalation](#15-sla-and-escalation)
16. [Files and attachments](#16-files-and-attachments)
17. [Reporting](#17-reporting)
18. [Data protection features](#18-data-protection-features)
19. [Non-functional requirements](#19-non-functional-requirements)
20. [Acceptance criteria](#20-acceptance-criteria)

---

## 1. Domain model

```
Organisation
 ├── Members (User × Role)
 ├── Invitations
 ├── IdentityProvider config
 ├── Groups
 └── ProcessDefinitions
       └── ProcessVersions (immutable, published)
             └── Cases (pinned to one version)
                   ├── Tasks
                   ├── Transitions
                   ├── Attachments
                   ├── Comments
                   └── AuditEvents

Templates (system | organisation | published)
   └── cloned → ProcessDefinition (hard copy, no back-reference)
```

**Entity definitions**

| Entity                 | Description                                                     | Store                                  |
| ---------------------- | --------------------------------------------------------------- | -------------------------------------- |
| **Organisation**       | A tenant. The root of all scoping.                              | Postgres                               |
| **User**               | A person. Global identity; may belong to several organisations. | Postgres                               |
| **OrganisationMember** | A user's membership of an organisation, with roles.             | Postgres                               |
| **ProcessDefinition**  | A named process. A registry row pointing at versions.           | Postgres (registry)                    |
| **ProcessVersion**     | An immutable published snapshot: form + workflow.               | Postgres (registry) + Mongo (document) |
| **Case**               | One running instance of one process version.                    | Postgres (state) + Mongo (values)      |
| **Task**               | A unit of work assigned to a person or role within a case.      | Postgres                               |
| **Transition**         | A recorded movement between steps.                              | Postgres                               |
| **AuditEvent**         | Append-only record of anything that happened.                   | Postgres                               |
| **Template**           | A non-runnable blueprint.                                       | Postgres (registry) + Mongo (document) |

---

## 2. PostgreSQL schema

All identifiers `snake_case`. All primary keys UUID v7. All timestamps `TIMESTAMPTZ` in UTC. Every tenant table has `organisation_id` immediately after the primary key and Row-Level Security enabled.

> **Identifier generation.** Postgres 16 provides no `uuidv7()` function; it arrives in Postgres 18, and the `pg_uuidv7` extension is not available on RDS. Primary keys are therefore generated in TypeScript inside `packages/db`, never by a column default and never in `packages/core`, which stays pure. See ADR-0003.

### 2.1 Identity and tenancy

```sql
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
```

### 2.2 Process definitions

```sql
CREATE TABLE process_definitions (
  definition_id       UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  key                 TEXT NOT NULL,             -- stable slug, e.g. 'laptop-request'
  name                TEXT NOT NULL,
  description         TEXT,
  category            TEXT,
  icon                TEXT,
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','published','archived')),
  current_version_id  UUID,                      -- FK added after process_versions
  reference_prefix    TEXT NOT NULL,             -- e.g. 'LAP' → LAP-000123
  reference_counter   BIGINT NOT NULL DEFAULT 0,
  retention_days      INTEGER,                   -- NULL = retain indefinitely
  created_by_user_id  UUID NOT NULL REFERENCES users(user_id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, key)
);

CREATE TABLE process_versions (
  version_id          UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  definition_id       UUID NOT NULL REFERENCES process_definitions(definition_id) ON DELETE CASCADE,
  version_number      INTEGER NOT NULL,
  document_id         TEXT NOT NULL,             -- Mongo _id of the definition document
  document_hash       TEXT NOT NULL,             -- SHA-256, integrity check
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','published','archived')),
  change_note         TEXT,
  published_by_user_id UUID REFERENCES users(user_id),
  published_at        TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (definition_id, version_number)
);

ALTER TABLE process_definitions
  ADD CONSTRAINT fk_current_version
  FOREIGN KEY (current_version_id) REFERENCES process_versions(version_id);
```

### 2.3 Cases and tasks

```sql
CREATE TABLE cases (
  case_id             UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  definition_id       UUID NOT NULL REFERENCES process_definitions(definition_id),
  version_id          UUID NOT NULL REFERENCES process_versions(version_id),  -- THE PIN
  reference           TEXT NOT NULL,             -- 'LAP-000123'
  title               TEXT NOT NULL,             -- derived from a designated form field
  status              TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','active','completed','rejected','cancelled','unassigned')),
  outcome             TEXT CHECK (outcome IN ('approved','rejected','cancelled','withdrawn')),
  current_step_key    TEXT,
  values_document_id  TEXT,                      -- Mongo _id of submitted values
  submitted_by_user_id UUID NOT NULL REFERENCES users(user_id),
  submitted_at        TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ,
  due_at              TIMESTAMPTZ,               -- overall case SLA
  row_version         INTEGER NOT NULL DEFAULT 1, -- optimistic concurrency
  redacted_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, reference)
);

CREATE INDEX idx_cases_org_status      ON cases (organisation_id, status);
CREATE INDEX idx_cases_org_submitter   ON cases (organisation_id, submitted_by_user_id, created_at DESC);
CREATE INDEX idx_cases_org_definition  ON cases (organisation_id, definition_id, created_at DESC);

CREATE TABLE case_tasks (
  task_id             UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  case_id             UUID NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  step_key            TEXT NOT NULL,
  step_name           TEXT NOT NULL,             -- snapshot: version may later be archived
  task_type           TEXT NOT NULL
                        CHECK (task_type IN ('approval','action','acknowledgement')),
  assignment_strategy TEXT NOT NULL,
  assignee_user_id    UUID REFERENCES users(user_id),
  assignee_group_id   UUID REFERENCES groups(group_id),
  assignee_role       TEXT,
  delegated_from_user_id UUID REFERENCES users(user_id),
  status              TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','claimed','completed','skipped','reassigned','cancelled','expired')),
  decision            TEXT CHECK (decision IN ('approved','rejected','returned','completed')),
  comment             TEXT,
  due_at              TIMESTAMPTZ,
  escalation_level    INTEGER NOT NULL DEFAULT 0,
  escalated_at        TIMESTAMPTZ,
  claimed_by_user_id  UUID REFERENCES users(user_id),
  claimed_at          TIMESTAMPTZ,
  completed_by_user_id UUID REFERENCES users(user_id),
  completed_at        TIMESTAMPTZ,
  row_version         INTEGER NOT NULL DEFAULT 1,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_assignee_pending
  ON case_tasks (organisation_id, assignee_user_id, status, due_at)
  WHERE status IN ('pending','claimed');
CREATE INDEX idx_tasks_case ON case_tasks (case_id, created_at);
CREATE INDEX idx_tasks_overdue
  ON case_tasks (due_at) WHERE status IN ('pending','claimed');

CREATE TABLE case_transitions (
  transition_id       UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  case_id             UUID NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  from_step_key       TEXT,
  to_step_key         TEXT,
  trigger_type        TEXT NOT NULL
                        CHECK (trigger_type IN ('submission','decision','escalation','timer','system','admin')),
  triggered_by_user_id UUID REFERENCES users(user_id),
  task_id             UUID REFERENCES case_tasks(task_id),
  condition_result    JSONB,                     -- which branch was taken and why
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_transitions_case ON case_transitions (case_id, occurred_at);

CREATE TABLE case_comments (
  comment_id          UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  case_id             UUID NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  author_user_id      UUID NOT NULL REFERENCES users(user_id),
  body                TEXT NOT NULL,
  visibility          TEXT NOT NULL DEFAULT 'all'
                        CHECK (visibility IN ('all','approvers')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### 2.4 Attachments, notifications, timers

```sql
CREATE TABLE attachments (
  attachment_id       UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  case_id             UUID REFERENCES cases(case_id) ON DELETE CASCADE,
  field_key           TEXT,
  s3_key              TEXT NOT NULL,
  file_name           TEXT NOT NULL,
  mime_type           TEXT NOT NULL,
  size_bytes          BIGINT NOT NULL,
  checksum_sha256     TEXT,
  scan_status         TEXT NOT NULL DEFAULT 'pending'
                        CHECK (scan_status IN ('pending','clean','infected','failed')),
  scan_completed_at   TIMESTAMPTZ,
  uploaded_by_user_id UUID NOT NULL REFERENCES users(user_id),
  uploaded_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at          TIMESTAMPTZ
);

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
  idempotency_key     TEXT NOT NULL UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_recipient_unread
  ON notifications (organisation_id, recipient_user_id, created_at DESC)
  WHERE read_at IS NULL AND channel = 'inApp';

CREATE TABLE notification_preferences (
  preference_id       UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  user_id             UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  event_type          TEXT NOT NULL,
  email_enabled       BOOLEAN NOT NULL DEFAULT true,
  in_app_enabled      BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (organisation_id, user_id, event_type)
);

CREATE TABLE sla_timers (
  timer_id            UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  case_id             UUID NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
  task_id             UUID REFERENCES case_tasks(task_id) ON DELETE CASCADE,
  schedule_name       TEXT NOT NULL,             -- EventBridge Scheduler schedule name
  timer_type          TEXT NOT NULL
                        CHECK (timer_type IN ('reminder','escalation','expiry')),
  escalation_level    INTEGER NOT NULL DEFAULT 0,
  fire_at             TIMESTAMPTZ NOT NULL,
  status              TEXT NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled','fired','cancelled')),
  fired_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE delegations (
  delegation_id       UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL REFERENCES organisations(organisation_id) ON DELETE CASCADE,
  from_user_id        UUID NOT NULL REFERENCES users(user_id),
  to_user_id          UUID NOT NULL REFERENCES users(user_id),
  starts_at           TIMESTAMPTZ NOT NULL,
  ends_at             TIMESTAMPTZ NOT NULL,
  reason              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (from_user_id <> to_user_id)
);
```

### 2.5 Audit and idempotency

```sql
CREATE TABLE audit_events (
  audit_event_id      UUID PRIMARY KEY,
  organisation_id     UUID NOT NULL,
  actor_user_id       UUID,
  actor_type          TEXT NOT NULL DEFAULT 'user'
                        CHECK (actor_type IN ('user','system','scheduler')),
  entity_type         TEXT NOT NULL,             -- 'case','task','definition','member', ...
  entity_id           UUID,
  action              TEXT NOT NULL,             -- 'case.submitted','task.approved', ...
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  correlation_id      TEXT,
  ip_address          INET,
  user_agent          TEXT,
  occurred_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_org_entity ON audit_events (organisation_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX idx_audit_org_time   ON audit_events (organisation_id, occurred_at DESC);

-- Two roles, deliberately distinct. The migration role owns the tables; the
-- application connects as orgflow_app and never owns anything. They must be
-- separate, because FORCE ROW LEVEL SECURITY still exempts a table's owner
-- unless the owner is itself subject to the policy, so an application running
-- as the owner would bypass tenant isolation entirely.
--
-- Created by the first migration, before any grant references the role.
CREATE ROLE orgflow_app NOLOGIN;

-- Append-only, enforced by grants rather than convention
REVOKE UPDATE, DELETE ON audit_events FROM orgflow_app;
GRANT  INSERT, SELECT  ON audit_events TO   orgflow_app;

CREATE TABLE idempotency_keys (
  idempotency_key     TEXT PRIMARY KEY,
  organisation_id     UUID,
  consumer            TEXT NOT NULL,
  result              JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL
);
```

### 2.6 Row-Level Security

Applied to every table carrying `organisation_id`.

```sql
ALTER TABLE cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE cases FORCE ROW LEVEL SECURITY;

-- The second argument to current_setting is missing_ok. Without it, the function
-- raises when the setting is absent, so every connection that has not yet set a
-- tenant errors on every query, including the migration runner and the readiness
-- check. With it, an unset tenant yields NULL, the comparison yields NULL, and
-- the policy denies the row. Failing closed is the correct behaviour.
CREATE POLICY tenant_isolation ON cases
  USING (
    organisation_id = NULLIF(current_setting('orgflow.organisation_id', true), '')::uuid
  );
```

The application sets `orgflow.organisation_id` **per transaction, with `SET LOCAL`**, from the authenticated session only.

> **This must not be per connection.** Under a connection pool, a value set on the connection outlives the request that set it and is inherited by whichever request is handed that connection next, which leaks one tenant's context into another tenant's query. `SET LOCAL` is scoped to the surrounding transaction and reverts on commit or rollback, so a pooled connection cannot carry stale tenant context. Every repository call therefore runs inside a transaction. See ADR-0004.

**Repeat for every tenant table.** RLS is defence in depth; the repository layer is the primary control.

---

## 3. MongoDB schema

All fields `camelCase`. No mapping layer. `organisationId` on every document, indexed.

### 3.1 Collections

| Collection           | Contents                              | Mutability                                           |
| -------------------- | ------------------------------------- | ---------------------------------------------------- |
| `processDefinitions` | Definition documents, one per version | Draft mutable; **published immutable**               |
| `templates`          | Template blueprints                   | Mutable                                              |
| `caseValues`         | Submitted field values, one per case  | Mutable until submission, then append-only revisions |

### 3.2 `caseValues`

```javascript
{
  _id: ObjectId,
  organisationId: "uuid",
  caseId: "uuid",
  versionId: "uuid",
  values: {
    laptopModel: "MacBook Pro 14",
    justification: "Current machine out of support",
    estimatedCost: 1899.00,
    requiredBy: "2026-09-01",
    isContractor: false,
    attachments: ["attachment-uuid-1"]
  },
  revisions: [
    {
      revisionNumber: 1,
      values: { /* prior snapshot */ },
      changedByUserId: "uuid",
      changedAt: ISODate(),
      reason: "returnedForChanges"
    }
  ],
  createdAt: ISODate(),
  updatedAt: ISODate()
}
```

Indexes: `{ organisationId: 1, caseId: 1 }` unique; `{ organisationId: 1, updatedAt: -1 }`.

---

## 4. The definition document

The central data structure of the product. Stored in `processDefinitions`.

```javascript
{
  _id: ObjectId,
  organisationId: "uuid",
  definitionId: "uuid",
  versionNumber: 3,
  key: "laptop-request",
  name: "Laptop request",
  description: "Request a new or replacement laptop",
  category: "IT",
  icon: "laptop",

  // ─────────────── FORM ───────────────
  form: {
    titleFieldKey: "laptopModel",     // used to title the case
    sections: [
      {
        key: "details",
        title: "Equipment details",
        description: "Tell us what you need",
        visibleWhen: null,             // condition AST or null
        fields: [
          {
            key: "laptopModel",
            type: "select",
            label: "Which model do you need?",
            hint: "Choose the closest match. IT will confirm exact specification.",
            required: true,
            options: [
              { value: "mbp14", label: "MacBook Pro 14-inch" },
              { value: "mbp16", label: "MacBook Pro 16-inch" },
              { value: "dellXps", label: "Dell XPS 15" },
              { value: "other", label: "Something else" }
            ],
            visibleWhen: null,
            validation: {},
            containsPersonalData: false
          },
          {
            key: "otherModelDetail",
            type: "text",
            label: "Describe what you need",
            required: true,
            visibleWhen: {
              field: "laptopModel", operator: "eq", value: "other"
            },
            validation: { maxLength: 200 }
          },
          {
            key: "estimatedCost",
            type: "currency",
            label: "Estimated cost",
            hint: "In pounds, excluding VAT",
            required: true,
            validation: { min: 0, max: 10000 }
          },
          {
            key: "justification",
            type: "textarea",
            label: "Why do you need this?",
            required: true,
            validation: { minLength: 20, maxLength: 2000 }
          },
          {
            key: "requiredBy",
            type: "date",
            label: "When do you need it by?",
            required: true,
            validation: { minDate: "today", maxDate: "+365d" }
          },
          {
            key: "quote",
            type: "file",
            label: "Attach a supplier quote",
            hint: "Required for anything over £1,000",
            required: false,
            visibleWhen: {
              field: "estimatedCost", operator: "gt", value: 1000
            },
            validation: {
              maxSizeBytes: 10485760,
              acceptedMimeTypes: ["application/pdf","image/png","image/jpeg"]
            }
          }
        ]
      }
    ]
  },

  // ─────────────── WORKFLOW ───────────────
  workflow: {
    startStepKey: "managerApproval",
    steps: [
      {
        key: "managerApproval",
        name: "Line manager approval",
        type: "approval",
        assignment: { strategy: "lineManager" },
        instructions: "Confirm this request is justified and within your team's budget.",
        allowedDecisions: ["approve","reject","return"],
        requireCommentOn: ["reject","return"],
        sla: {
          durationHours: 48,
          businessHoursOnly: true,
          reminders: [{ atHoursBefore: 12 }],
          escalation: [
            { atHoursAfter: 24, strategy: "lineManagerOfAssignee" },
            { atHoursAfter: 72, strategy: "role", role: "processOwner" }
          ]
        },
        transitions: {
          approve: [
            {
              when: { field: "estimatedCost", operator: "gt", value: 1000 },
              to: "financeApproval"
            },
            { when: null, to: "itFulfilment" }        // default branch
          ],
          reject: [{ when: null, to: "$rejected" }],
          return:  [{ when: null, to: "$returnedToRequester" }]
        }
      },
      {
        key: "financeApproval",
        name: "Finance approval",
        type: "approval",
        assignment: { strategy: "role", role: "financeApprover" },
        instructions: "Check the cost code and budget availability.",
        allowedDecisions: ["approve","reject"],
        requireCommentOn: ["reject"],
        sla: { durationHours: 72, businessHoursOnly: true },
        transitions: {
          approve: [{ when: null, to: "itFulfilment" }],
          reject:  [{ when: null, to: "$rejected" }]
        }
      },
      {
        key: "itFulfilment",
        name: "IT fulfilment",
        type: "action",
        assignment: { strategy: "group", groupKey: "itSupport" },
        instructions: "Order the equipment and record the asset tag.",
        allowedDecisions: ["complete"],
        outputFields: [
          { key: "assetTag", type: "text", label: "Asset tag", required: true }
        ],
        sla: { durationHours: 120, businessHoursOnly: true },
        transitions: {
          complete: [{ when: null, to: "$completed" }]
        }
      }
    ]
  },

  // ─────────────── NOTIFICATIONS ───────────────
  notifications: {
    onSubmit:   [{ to: "submitter", template: "caseSubmitted" }],
    onComplete: [{ to: "submitter", template: "caseCompleted" }],
    onReject:   [{ to: "submitter", template: "caseRejected" }]
  },

  // ─────────────── METADATA ───────────────
  retentionDays: 2555,
  createdByUserId: "uuid",
  createdAt: ISODate(),
  publishedAt: ISODate(),
  publishedByUserId: "uuid"
}
```

### 4.1 Terminal step keys

Reserved, prefixed `$`, never user-definable:

| Key                    | Meaning                                                 |
| ---------------------- | ------------------------------------------------------- |
| `$completed`           | Case closed successfully. `outcome = 'approved'`        |
| `$rejected`            | Case closed with rejection. `outcome = 'rejected'`      |
| `$cancelled`           | Case cancelled by requester or admin                    |
| `$returnedToRequester` | Returned for amendment; requester may edit and resubmit |

### 4.2 Field types

| Type          | Storage         | Validation options                              |
| ------------- | --------------- | ----------------------------------------------- |
| `text`        | string          | `minLength`, `maxLength`, `pattern`             |
| `textarea`    | string          | `minLength`, `maxLength`                        |
| `number`      | number          | `min`, `max`, `step`                            |
| `currency`    | number (2dp)    | `min`, `max`                                    |
| `select`      | string          | `options`                                       |
| `multiSelect` | string[]        | `options`, `minSelections`, `maxSelections`     |
| `radio`       | string          | `options`                                       |
| `checkbox`    | boolean         | none                                            |
| `date`        | ISO date        | `minDate`, `maxDate` (supports `today`, `+30d`) |
| `dateTime`    | ISO datetime    | `minDate`, `maxDate`                            |
| `file`        | attachment id[] | `maxSizeBytes`, `acceptedMimeTypes`, `maxFiles` |
| `user`        | user id         | `restrictToRole`, `restrictToGroup`             |
| `email`       | string          | format-validated                                |
| `phone`       | string          | format-validated                                |
| `heading`     | not stored      | display only                                    |
| `paragraph`   | not stored      | display only                                    |

Every field additionally supports: `key`, `label`, `hint`, `required`, `defaultValue`, `visibleWhen`, `containsPersonalData`, `readOnlyAfterSubmit`.

### 4.3 Step types

| Type              | Behaviour                                                               |
| ----------------- | ----------------------------------------------------------------------- |
| `approval`        | Creates a task with approve / reject / return decisions                 |
| `action`          | Creates a task requiring completion, optionally capturing output fields |
| `acknowledgement` | Creates a task requiring only confirmation of receipt                   |
| `automatic`       | No task; evaluates conditions and transitions immediately               |

_(`parallel` is a v2 addition. The schema accommodates it; the engine does not implement it initially.)_

---

## 5. The condition expression language

A declarative JSON AST evaluated by a pure function in `packages/core`. **Never `eval`. Never a templating engine.** Tenant-authored expressions are untrusted input.

### 5.1 Grammar

```typescript
type Condition =
  | { field: string; operator: Operator; value?: unknown }
  | { all: Condition[] } // logical AND
  | { any: Condition[] } // logical OR
  | { not: Condition }
  | null; // always true: the default branch

type Operator =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'notIn'
  | 'contains'
  | 'notContains'
  | 'startsWith'
  | 'endsWith'
  | 'isEmpty'
  | 'isNotEmpty'
  | 'isTrue'
  | 'isFalse';
```

### 5.2 Field references

- Form values: `"estimatedCost"`, resolved against the case's submitted values
- Context values, prefixed `$`:

| Reference               | Resolves to                 |
| ----------------------- | --------------------------- |
| `$submitter.department` | Submitter's department      |
| `$submitter.roles`      | Submitter's roles array     |
| `$case.daysOpen`        | Whole days since submission |
| `$step.escalationLevel` | Current escalation level    |
| `$now`                  | Current UTC timestamp       |

### 5.3 Null and missing semantics, specified explicitly

This is the most common source of workflow bugs. Behaviour is defined, not incidental.

| Situation                                                 | Result                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------- |
| Field absent from values                                  | Treated as `null`                                                       |
| Field is `null`, operator is `eq`/`neq`                   | Compared normally; `null eq null` is `true`                             |
| Field is `null`, operator is a comparison (`gt`, `lt`, …) | **`false`**, never an error                                             |
| Field is `null`, operator is `isEmpty`                    | `true`                                                                  |
| Empty string, empty array                                 | `isEmpty` is `true`                                                     |
| Type mismatch (string vs number)                          | **`false`**, and a warning is logged                                    |
| Unknown field key                                         | **`false`**, and a warning is logged                                    |
| Unknown operator                                          | Throws. This is a definition validation failure, caught at publish time |

**Guiding principle:** condition evaluation never throws at runtime. An unevaluable condition is `false`. A workflow must never crash a case because a field was missing.

### 5.4 Branch selection

`transitions[decision]` is an **ordered array**. The engine evaluates each in order and takes the **first** whose `when` is `true`. A `when: null` entry is the default and must be last. Validation at publish time rejects a transitions array whose last entry is not the default.

---

## 6. The workflow engine

`packages/core/src/engine`. **Pure. No I/O.**

### 6.1 Signature

```typescript
interface EngineInput {
  definition: ProcessDefinitionDocument; // the PINNED version
  caseState: CaseState;
  values: Record<string, unknown>;
  event: EngineEvent;
  context: EvaluationContext; // submitter, roles, now
}

interface EngineOutput {
  caseUpdates: Partial<CaseState>;
  tasksToCreate: TaskSpec[];
  tasksToCancel: string[];
  transitions: TransitionRecord[];
  eventsToEmit: DomainEvent[];
  timersToSchedule: TimerSpec[];
  timersToCancel: string[];
  errors: EngineError[];
}

function advance(input: EngineInput): EngineOutput;
```

The caller, `apps/api`, persists everything the engine returns, in one transaction, then publishes the events.

### 6.2 Engine events

| Event                 | Trigger                                    |
| --------------------- | ------------------------------------------ |
| `caseSubmitted`       | Requester submits a draft                  |
| `taskDecided`         | An approver records a decision             |
| `taskExpired`         | An SLA expiry timer fires                  |
| `escalationTriggered` | An escalation timer fires                  |
| `caseCancelled`       | Requester or admin cancels                 |
| `caseResubmitted`     | A returned case is amended and resubmitted |

### 6.3 Advance algorithm

```
1. Validate the event against the current case state.
   Reject if the case is terminal or the task is not actionable.

2. Record the decision on the task.

3. Resolve the next step:
   a. Read transitions[decision] from the current step.
   b. Evaluate each entry's `when` in order against values + context.
   c. Take the first true. If none match and no default exists,
      that is a definition validation failure: record an engine error
      and move the case to 'unassigned' rather than crashing.

4. If the next step is terminal ($completed, $rejected, $cancelled):
   - set case status and outcome
   - cancel all outstanding tasks and timers
   - emit case.completed / case.rejected
   - stop.

5. If the next step is $returnedToRequester:
   - set case status to 'active', current step null
   - create a task assigned to the submitter
   - emit case.returned
   - stop.

6. Otherwise:
   - resolve the assignee (section 7)
   - if resolution yields nobody, set case status 'unassigned',
     emit case.unassigned, and stop. Do not fail silently
   - create the task
   - compute due_at from the SLA (business hours aware)
   - schedule reminder, escalation and expiry timers
   - record the transition, including which condition matched
   - emit task.created and case.stepChanged

7. If the step type is 'automatic':
   - create no task; immediately re-enter step 3 with the automatic
     step's transitions. Guard against loops with a maximum of
     20 automatic steps per advance.
```

### 6.4 Invariants

- The engine reads only the pinned definition version. It never queries for the current version.
- The engine never mutates its inputs.
- The engine is deterministic. The same inputs produce the same outputs, with `now` injected via context rather than read from the clock.
- The engine never throws on tenant data. Invalid definitions produce `EngineError` entries in the output.
- Every state change produces a transition record. There are no silent transitions.

---

## 7. Assignment resolution

```typescript
type AssignmentStrategy =
  | { strategy: 'specificUser'; userId: string }
  | { strategy: 'role'; role: string }
  | { strategy: 'lineManager' }
  | { strategy: 'lineManagerOfAssignee' }
  | { strategy: 'submitter' }
  | { strategy: 'group'; groupKey: string }
  | { strategy: 'fieldReference'; fieldKey: string };
```

| Strategy                | Resolution                                                                             | Failure behaviour                       |
| ----------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| `specificUser`          | Named user; must be an active member                                                   | Case → `unassigned`                     |
| `role`                  | All active members holding the role. Task is claimable by any; first to claim owns it. | Case → `unassigned`                     |
| `lineManager`           | Submitter's `line_manager_user_id`                                                     | Case → `unassigned`                     |
| `lineManagerOfAssignee` | Line manager of the current assignee, used for escalation                              | Falls back to the next escalation level |
| `submitter`             | The person who raised the case                                                         | Cannot fail                             |
| `group`                 | All active group members; claimable                                                    | Case → `unassigned`                     |
| `fieldReference`        | User selected in a `user`-type field                                                   | Case → `unassigned`                     |

**Rules**

- Resolution occurs at task creation. The outcome is persisted on the task. Later membership changes do not retroactively reassign an existing task.
- **Delegation is applied at resolution time.** If the resolved user has an active delegation covering `now`, the task is assigned to the delegate with `delegated_from_user_id` recorded. Both parties can see it; only the delegate can act.
- **Self-approval guard.** If the resolved assignee is the submitter and the step type is `approval`, the engine emits a warning and escalates one level. Definitions may opt out via `allowSelfApproval: true` on the step.
- `unassigned` is an explicit, visible case state requiring administrative action. It is never a silent failure.

---

## 8. Versioning rules

**The most important correctness property in the product.**

### 8.1 Lifecycle

```
draft ──publish──> published ──supersede──> archived
  │                    │
  └──discard           └──(remains readable forever; cases still execute it)
```

- A definition has at most one `draft` version at a time.
- Publishing sets `published_at`, makes the Mongo document **immutable**, and updates `process_definitions.current_version_id`.
- The previously published version becomes `archived` but is never deleted, because cases pinned to it must continue to execute.

### 8.2 Pinning

- `cases.version_id` is set at submission and **never changes**.
- The engine loads the definition by `cases.version_id`.
- Loading by `definition_id` alone anywhere in the codebase is a defect.

### 8.3 Draft editing

- Drafts are freely editable.
- Publish-time validation must pass:
  - every `transitions.to` references an existing step or a reserved terminal key
  - every step is reachable from `startStepKey`
  - every non-terminal step has at least one transition per allowed decision
  - every transitions array ends with a `when: null` default
  - every `visibleWhen` and `when` references a field that exists in the form
  - no field key is duplicated
  - every operator is recognised
  - a required field that is only conditionally visible is flagged as a warning
- Validation failures block publication with per-error field paths.

### 8.4 Returned cases

When a case is returned to the requester and resubmitted, it **remains on its original pinned version**. A returned case never silently upgrades. The rationale: the requester is amending against the form they saw.

### 8.5 Migration

There is no automatic migration of in-flight cases to a new version. If a version contains a critical error, an organisation admin may explicitly cancel affected cases with a recorded reason. This is a deliberate design choice, because silent migration would falsify the audit trail.

---

## 9. Templates

### 9.1 Scopes

| Scope          | Owner            | Visibility                         | Editable               |
| -------------- | ---------------- | ---------------------------------- | ---------------------- |
| `system`       | OrgFlow          | All organisations                  | No, read-only          |
| `organisation` | One organisation | That organisation                  | Yes, by process owners |
| `published`    | One organisation | All organisations (opt-in library) | By owner only          |

### 9.2 Cloning

- Cloning a template creates a new `process_definition` plus a `draft` `process_version` in the target organisation.
- The clone is a **hard copy**. No `template_id` reference is retained. Later template edits never reach it.
- On clone: keys are regenerated where they would collide, assignment strategies referencing specific users or groups are reset to unresolved and flagged for configuration, and the definition opens in the builder for review.

### 9.3 System catalogue, minimum six

1. **Laptop or equipment request:** cost-conditional finance approval
2. **System access request:** manager plus security approval
3. **Expense claim:** threshold-based approval chain
4. **New starter onboarding:** sequential HR, IT, facilities, payroll
5. **Annual leave request:** single-step manager approval
6. **Policy exception or risk acceptance:** risk owner plus security, long SLA

Each demonstrates a different engine capability, so the catalogue doubles as engine test coverage.

---

## 10. Event catalogue

Published to SNS. Every event carries a common envelope.

```typescript
interface DomainEvent {
  eventId: string;
  eventType: string;
  organisationId: string; // ALWAYS present, re-asserted by consumers
  occurredAt: string; // ISO 8601 UTC
  actorUserId: string | null;
  actorType: 'user' | 'system' | 'scheduler';
  correlationId: string;
  payload: Record<string, unknown>;
  schemaVersion: 1;
}
```

| Event type             | Emitted when                      | Key payload                                   |
| ---------------------- | --------------------------------- | --------------------------------------------- |
| `organisation.created` | New org created                   | `organisationId`, `createdBy`                 |
| `member.invited`       | Invitation sent                   | `email`, `roles`                              |
| `member.joined`        | Invitation accepted               | `userId`                                      |
| `member.removed`       | Membership revoked                | `userId`                                      |
| `definition.published` | Version published                 | `definitionId`, `versionId`, `versionNumber`  |
| `definition.archived`  | Definition archived               | `definitionId`                                |
| `case.submitted`       | Draft submitted                   | `caseId`, `reference`, `versionId`            |
| `case.stepChanged`     | Case advanced                     | `fromStepKey`, `toStepKey`, `conditionResult` |
| `case.returned`        | Returned to requester             | `caseId`, `reason`                            |
| `case.resubmitted`     | Amended and resubmitted           | `caseId`, `revisionNumber`                    |
| `case.completed`       | Reached `$completed`              | `caseId`, `durationSeconds`                   |
| `case.rejected`        | Reached `$rejected`               | `caseId`, `rejectedAtStep`, `reason`          |
| `case.cancelled`       | Cancelled                         | `caseId`, `reason`                            |
| `case.unassigned`      | Assignment resolution failed      | `caseId`, `stepKey`, `strategy`               |
| `task.created`         | Task created                      | `taskId`, `assigneeUserId`, `dueAt`           |
| `task.claimed`         | Claimed from a role or group pool | `taskId`, `claimedBy`                         |
| `task.decided`         | Decision recorded                 | `taskId`, `decision`, `comment`               |
| `task.reassigned`      | Manually reassigned               | `taskId`, `fromUserId`, `toUserId`            |
| `task.delegated`       | Assigned to a delegate            | `taskId`, `delegatedFrom`                     |
| `task.reminderDue`     | Reminder timer fired              | `taskId`, `hoursRemaining`                    |
| `task.escalated`       | Escalation timer fired            | `taskId`, `escalationLevel`, `escalatedTo`    |
| `task.expired`         | Expiry timer fired                | `taskId`                                      |
| `attachment.uploaded`  | Upload completed                  | `attachmentId`, `caseId`                      |
| `attachment.scanned`   | Virus scan completed              | `attachmentId`, `scanStatus`                  |
| `export.requested`     | Export queued                     | `exportId`, `type`                            |
| `export.completed`     | Export ready                      | `exportId`, `s3Key`                           |

**Consumer contract**

- Every consumer is idempotent, keyed on `eventId`.
- Every consumer re-asserts `organisationId` before touching data.
- Unknown event types are ignored, not errored, for forward compatibility.
- Every queue has a DLQ with an alarm on non-zero depth.

---

## 11. API surface

Base: `/api/v1`. JSON, `camelCase`. Errors follow RFC 7807 problem details. Tenant context derives from the session; `organisationId` is **never** accepted from the client.

### 11.1 Authentication

| Method | Path                        | Purpose                                           |
| ------ | --------------------------- | ------------------------------------------------- |
| `GET`  | `/auth/providers?email=`    | Resolve IdP for an email domain                   |
| `GET`  | `/auth/login`               | Begin OIDC authorization code + PKCE flow         |
| `GET`  | `/auth/callback`            | OIDC redirect handler                             |
| `POST` | `/auth/logout`              | End session                                       |
| `GET`  | `/auth/session`             | Current user, organisations, roles, permissions   |
| `POST` | `/auth/switch-organisation` | Change active organisation context                |
| `POST` | `/auth/dev-login`           | **Local only.** Fails closed outside development. |

### 11.2 Organisations and members

| Method                        | Path                         | Purpose                                |
| ----------------------------- | ---------------------------- | -------------------------------------- |
| `POST`                        | `/organisations`             | Self-serve creation                    |
| `GET`                         | `/organisations/current`     | Active organisation                    |
| `PATCH`                       | `/organisations/current`     | Update name, branding, settings        |
| `GET`                         | `/members`                   | List members (paginated, filterable)   |
| `PATCH`                       | `/members/:userId`           | Update roles, department, line manager |
| `DELETE`                      | `/members/:userId`           | Remove member                          |
| `POST`                        | `/invitations`               | Invite by email                        |
| `GET`                         | `/invitations`               | List pending                           |
| `DELETE`                      | `/invitations/:id`           | Revoke                                 |
| `POST`                        | `/invitations/:token/accept` | Accept (unauthenticated by org)        |
| `GET`/`POST`/`PATCH`/`DELETE` | `/groups`, `/groups/:id`     | Group management                       |
| `GET`/`POST`/`PATCH`          | `/identity-providers`        | IdP configuration                      |

### 11.3 Definitions

| Method   | Path                                           | Purpose                                 |
| -------- | ---------------------------------------------- | --------------------------------------- |
| `GET`    | `/process-definitions`                         | List, filterable by status and category |
| `POST`   | `/process-definitions`                         | Create (blank or from template)         |
| `GET`    | `/process-definitions/:id`                     | Definition with current version         |
| `PATCH`  | `/process-definitions/:id`                     | Update metadata                         |
| `DELETE` | `/process-definitions/:id`                     | Archive (never hard delete)             |
| `GET`    | `/process-definitions/:id/versions`            | Version history                         |
| `GET`    | `/process-definitions/:id/versions/:versionId` | Specific version document               |
| `POST`   | `/process-definitions/:id/draft`               | Create draft from current version       |
| `PUT`    | `/process-definitions/:id/draft`               | Save draft document                     |
| `POST`   | `/process-definitions/:id/draft/validate`      | Validate without publishing             |
| `POST`   | `/process-definitions/:id/draft/publish`       | Publish draft as new version            |
| `DELETE` | `/process-definitions/:id/draft`               | Discard draft                           |

### 11.4 Templates

| Method  | Path                                               | Purpose                                             |
| ------- | -------------------------------------------------- | --------------------------------------------------- |
| `GET`   | `/templates?scope=system\|organisation\|published` | Browse catalogue                                    |
| `GET`   | `/templates/:id`                                   | Template detail                                     |
| `POST`  | `/templates`                                       | Save current definition as an organisation template |
| `POST`  | `/templates/:id/clone`                             | Clone into a new definition                         |
| `PATCH` | `/templates/:id`                                   | Update (organisation scope only)                    |
| `POST`  | `/templates/:id/publish-to-library`                | Share publicly                                      |

### 11.5 Cases

| Method  | Path                  | Purpose                                                                  |
| ------- | --------------------- | ------------------------------------------------------------------------ |
| `GET`   | `/cases`              | List. Filters: `status`, `definitionId`, `submittedBy`, `view=mine\|all` |
| `POST`  | `/cases`              | Create draft against a definition                                        |
| `GET`   | `/cases/:id`          | Full case: state, values, tasks, timeline, attachments                   |
| `PATCH` | `/cases/:id`          | Update draft values                                                      |
| `POST`  | `/cases/:id/submit`   | Submit. Pins the version, starts the engine                              |
| `POST`  | `/cases/:id/resubmit` | Resubmit a returned case                                                 |
| `POST`  | `/cases/:id/cancel`   | Cancel with reason                                                       |
| `GET`   | `/cases/:id/timeline` | Transitions, decisions, comments and audit, merged                       |
| `GET`   | `/cases/:id/audit`    | Raw audit events                                                         |
| `POST`  | `/cases/:id/comments` | Add comment                                                              |
| `POST`  | `/cases/:id/validate` | Validate values without submitting                                       |

### 11.6 Tasks

| Method                | Path                  | Purpose                                                                |
| --------------------- | --------------------- | ---------------------------------------------------------------------- |
| `GET`                 | `/tasks`              | Assigned to current user. Filters: `status`, `overdue`, `definitionId` |
| `GET`                 | `/tasks/available`    | Claimable role/group tasks                                             |
| `GET`                 | `/tasks/:id`          | Task with full case context                                            |
| `POST`                | `/tasks/:id/claim`    | Claim from a pool                                                      |
| `POST`                | `/tasks/:id/decide`   | Record decision. Body: `decision`, `comment`, `outputValues`           |
| `POST`                | `/tasks/:id/reassign` | Reassign (permission-gated)                                            |
| `GET`/`POST`/`DELETE` | `/delegations`        | Out-of-office delegation                                               |

### 11.7 Attachments

| Method   | Path                          | Purpose                                                                         |
| -------- | ----------------------------- | ------------------------------------------------------------------------------- |
| `POST`   | `/attachments/presign-upload` | Presigned POST. Body: `caseId`, `fieldKey`, `fileName`, `mimeType`, `sizeBytes` |
| `POST`   | `/attachments/:id/confirm`    | Confirm upload, queue scan                                                      |
| `GET`    | `/attachments/:id/download`   | Presigned GET. **404 unless `scanStatus = 'clean'`**                            |
| `DELETE` | `/attachments/:id`            | Soft delete                                                                     |

### 11.8 Reporting

| Method | Path                       | Purpose                                                 |
| ------ | -------------------------- | ------------------------------------------------------- |
| `GET`  | `/reports/overview`        | Volume, completion rate, median turnaround              |
| `GET`  | `/reports/definitions/:id` | Per-process metrics                                     |
| `GET`  | `/reports/bottlenecks`     | Mean time per step, ranked                              |
| `GET`  | `/reports/approver-load`   | Volume and turnaround per approver (permission-gated)   |
| `POST` | `/exports`                 | Request CSV or PDF export, asynchronously via the queue |
| `GET`  | `/exports/:id`             | Status and download link                                |

### 11.9 Data protection

| Method        | Path                                      | Purpose                                        |
| ------------- | ----------------------------------------- | ---------------------------------------------- |
| `GET`         | `/data-protection/subject-export?userId=` | All data relating to a subject                 |
| `POST`        | `/data-protection/redact`                 | Redact personal content, retain audit skeleton |
| `GET`/`PATCH` | `/data-protection/retention`              | Retention policy per definition                |

### 11.10 Conventions

- Pagination: cursor-based. `?limit=50&cursor=...`. Response: `{ data, nextCursor, hasMore }`.
- Sorting: `?sort=createdAt&order=desc`.
- Errors: RFC 7807, giving `type`, `title`, `status`, `detail`, `instance`, plus `errors[]` with `field` and `message` for validation.
- **Cross-tenant access returns `404`, never `403`**, because a `403` confirms the resource exists.
- Idempotency: `Idempotency-Key` header supported on all `POST` endpoints that create resources.
- Correlation: `X-Correlation-Id` accepted and propagated; generated when absent.

---

## 12. Authentication and authorisation

### 12.1 Flow

```
1. User enters email at /login
2. GET /auth/providers?email= → resolve IdP by verified domain
3. Redirect to IdP (authorization code + PKCE)
4. IdP redirects to /auth/callback
5. Exchange code, validate ID token (signature, iss, aud, exp, nonce)
6. Find or create user by (issuer, subject)
7. Resolve organisation memberships
8. Create session; set httpOnly Secure SameSite=Lax cookie
9. If multiple organisations, prompt for selection
```

**Local development:** `POST /auth/dev-login` with a seeded email. Guarded by `ORGFLOW_ENV === 'local'` **and** the absence of a deployed-environment marker. Fails closed.

### 12.2 Roles

Per organisation, not global.

| Role           | Capabilities                                                                           |
| -------------- | -------------------------------------------------------------------------------------- |
| `member`       | Submit cases, view own cases, act on assigned tasks                                    |
| `approver`     | Plus: act on role-assigned tasks                                                       |
| `processOwner` | Plus: create and publish definitions, view all cases for owned processes, view reports |
| `admin`        | Plus: manage members, groups, IdP, retention; view all cases                           |
| `owner`        | Plus: manage organisation settings, delete organisation                                |

Roles are additive. A user may hold several.

### 12.3 Permission checks

Two distinct questions, always evaluated separately:

- **Visibility.** May this user _see_ this case? True if: submitter, current or past assignee, process owner of the definition, or admin.
- **Actionability.** May this user _act_ on this task? True only if: the resolved assignee, an active delegate of the assignee, or a member of the assigned role or group for an unclaimed task.

Both are evaluated server-side on every request. Client-side checks are presentation only.

---

## 13. Screens

### 13.1 Structure

```
/login
/organisations/new
/invitations/:token

/(app)
  /                          Dashboard
  /catalogue                 Browse available processes
  /catalogue/:definitionKey  Process detail + start
  /cases/new/:definitionKey  Form runtime (submit)
  /cases                     My requests
  /cases/:id                 Case detail + timeline
  /approvals                 My approval queue
  /approvals/:taskId         Decision screen
  /processes                 Manage definitions (processOwner+)
  /processes/:id             Definition overview + versions
  /processes/:id/form        Form builder
  /processes/:id/workflow    Workflow builder
  /processes/:id/settings    Metadata, retention, notifications
  /templates                 Template catalogue
  /reports                   Analytics
  /reports/:definitionId     Per-process metrics
  /admin/members             Member management (admin+)
  /admin/groups
  /admin/identity
  /admin/retention
  /settings/profile
  /settings/notifications
  /settings/delegation
```

### 13.2 Key screens

**Dashboard**

- Approvals awaiting me, overdue first, count badge
- My open requests with live status
- Quick-start tiles for frequent processes
- Empty state directing to the catalogue

**Approval queue**, the highest-value screen in the product

- Sorted by due date ascending, overdue pinned to top
- Each row: reference, process, requester, age, due, urgency indicator (**icon plus text, never colour alone**)
- Filters: process, overdue, claimed/unclaimed
- Bulk approve for low-risk processes, permission-gated
- Keyboard navigable: arrow keys between rows, Enter to open

**Decision screen**

- Every piece of information needed to decide, on one screen, with no expanding and no navigating away
- Submitted values in a read-only summary
- Attachments, download-gated on clean scan status
- Prior decisions in this case, with comments
- Requester context: name, department, line manager
- Decision actions with comment field; comment mandatory where the definition requires it
- Confirmation step for irreversible decisions

**Form builder**

- Three panes: field palette, canvas, properties
- Drag to add and reorder, **plus a full keyboard alternative** (move up, move down, move to section), with `aria-live` announcements
- Conditional visibility configured through a rule builder UI, never raw JSON
- Live preview toggling to the exact runtime rendering
- Validation panel surfacing publish-blocking errors
- Personal data flag on each field, with an acknowledgement prompt

**Workflow builder**

- React Flow canvas; steps as nodes, transitions as edges
- Per-step panel: name, type, assignment strategy, instructions, allowed decisions, SLA, escalation
- Branch conditions via the same rule builder as the form
- Live validation: unreachable steps, missing defaults, orphaned branches highlighted on canvas
- **Keyboard alternative:** a list view of steps and transitions, fully operable without the canvas

**Case detail**

- Header: reference, process, status, submitted date, requester
- Progress indicator showing completed, current and remaining steps
- Submitted values, marking any changed on resubmission
- Timeline: transitions, decisions, comments, escalations, chronological
- Attachments
- Actions: cancel, comment, resubmit if returned

---

## 14. Notifications

### 14.1 Templates

| Key                 | Trigger                     | Recipient                                |
| ------------------- | --------------------------- | ---------------------------------------- |
| `caseSubmitted`     | `case.submitted`            | Submitter                                |
| `taskAssigned`      | `task.created`              | Assignee                                 |
| `taskClaimable`     | `task.created` (role/group) | Eligible members                         |
| `taskReminder`      | `task.reminderDue`          | Assignee                                 |
| `taskEscalated`     | `task.escalated`            | Escalation target, and original assignee |
| `caseReturned`      | `case.returned`             | Submitter                                |
| `caseCompleted`     | `case.completed`            | Submitter                                |
| `caseRejected`      | `case.rejected`             | Submitter                                |
| `caseUnassigned`    | `case.unassigned`           | Organisation admins                      |
| `delegationStarted` | Delegation activates        | Delegate                                 |

### 14.2 Rules

- Every notification links directly to the actionable screen, not a generic landing page.
- Subject lines lead with the reference and action: `LAP-000123 Approval needed: Laptop request`.
- Content follows §8 of `GOV-STANDARDS.md`: plain English, active voice, explicit next action.
- Per-user, per-event-type preferences. Some notification types cannot be disabled (`taskAssigned`).
- Delivery is idempotent, keyed on `eventId` plus `recipientUserId` plus `templateKey`.
- Delivery failures are recorded and retried with exponential backoff, then dead-lettered.
- **A notification failure never blocks a workflow transition.** The engine has already committed.

---

## 15. SLA and escalation

### 15.1 Calculation

- `durationHours` from the step definition.
- `businessHoursOnly: true` (default) excludes weekends and configured organisation holidays. Business hours default 09:00–17:00 in the organisation's timezone.
- `due_at` computed at task creation and persisted. It does not shift if the definition changes.

### 15.2 Timers

Three types, all EventBridge Scheduler one-off schedules created at task creation:

| Type         | Fires                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| `reminder`   | At each configured `atHoursBefore` the deadline                              |
| `escalation` | At each configured `atHoursAfter` the deadline                               |
| `expiry`     | At an optional hard expiry, after which the task auto-decides per `onExpiry` |

All timers for a task are cancelled when the task is completed, reassigned or cancelled.

### 15.3 Escalation

- Escalation **adds** an assignee; it does not remove the original. Both can act.
- Each level increments `escalation_level` and is recorded as an audit event.
- `lineManagerOfAssignee` falling through with no result advances to the next level rather than failing.
- If all escalation levels are exhausted, the case is flagged for admin attention and organisation admins are notified.

---

## 16. Files and attachments

### 16.1 Upload flow

```
1. Client POSTs metadata to /attachments/presign-upload
2. API validates against the field's declared constraints
   (mime type, size), creates an attachment row (scanStatus 'pending'),
   returns a presigned POST with content-length and content-type conditions
3. Client uploads directly to S3
4. Client POSTs /attachments/:id/confirm
5. API verifies the object exists, emits attachment.uploaded
6. SQS → Lambda: virus scan (ClamAV layer)
7. Lambda updates scanStatus, emits attachment.scanned
8. If infected: object moved to a quarantine prefix, an audit event
   is written, the uploader is notified, and download is permanently refused
```

### 16.2 Rules

- **Download returns `404` unless `scanStatus = 'clean'`.** No exceptions, including for admins.
- Presigned download URLs expire in 15 minutes and are generated per request.
- MIME type validated by content sniffing server-side, not by the client-supplied header or the file extension.
- Every download generates an audit event.
- Case attachments follow the case retention policy.

---

## 17. Reporting

### 17.1 Metrics

| Metric            | Definition                                                              |
| ----------------- | ----------------------------------------------------------------------- |
| Volume            | Cases submitted per period, by process                                  |
| Completion rate   | Completed ÷ (completed + rejected + cancelled)                          |
| Median turnaround | Submission to terminal state, median not mean, because outliers distort |
| p90 turnaround    | Tail latency; better indicator of user experience                       |
| Step duration     | Mean and median time per step. **This is the bottleneck view**          |
| Rejection reasons | Grouped by step and comment sentiment                                   |
| Approver load     | Tasks handled and median turnaround per approver                        |
| Escalation rate   | Proportion of tasks escalating at least once                            |
| Return rate       | Proportion returned to requester at least once, a form quality signal   |

### 17.2 Rules

- **Aggregate by default.** Individual-level views, including approver load, are permission-gated. Reporting must not become a staff monitoring tool. See `GOV-STANDARDS.md` §7.
- Suppress groups smaller than five to prevent re-identification.
- Exports run asynchronously via the queue, delivered as a presigned S3 link.
- Reporting queries read from Postgres for state and Mongo aggregation for value-level analysis.

---

## 18. Data protection features

| Feature                    | Behaviour                                                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Personal data flagging** | Builder marks fields with `containsPersonalData`. Flagged fields are redaction targets and are excluded from exports by default.                                                                           |
| **Retention**              | Per definition, in days. A scheduled Lambda finds expired cases nightly and redacts them.                                                                                                                  |
| **Redaction**              | Personal values replaced with a tombstone; attachments deleted; audit skeleton retained (who decided what, and when, with content removed). `redacted_at` set. **The redaction is itself an audit event.** |
| **Subject access export**  | All data relating to a user across cases they submitted, decided on, or are named in. JSON plus attachment manifest.                                                                                       |
| **Erasure**                | Implemented as redaction, not deletion. The record that a decision occurred is typically retained under legal obligation; personal content is removed.                                                     |
| **Region**                 | Configurable, defaulting to `eu-west-2`.                                                                                                                                                                   |

---

## 19. Non-functional requirements

| Category            | Requirement                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| **Performance**     | API p95 < 300ms for reads, < 800ms for writes. Approval queue renders < 1s at 500 tasks. Form builder responsive at 100 fields. |
| **Scalability**     | 1,000 organisations, 10,000 members per organisation, 100,000 cases per organisation. Queue-based async absorbs bursts.         |
| **Availability**    | 99.5% target. Notification, export or scan outage must not block submission or approval.                                        |
| **Durability**      | Postgres PITR with a 7-day window. S3 versioning. Restore rehearsed at least once.                                              |
| **Security**        | Full compliance with `GOV-STANDARDS.md` §6. Zero high or critical findings.                                                     |
| **Accessibility**   | WCAG 2.2 AA across every screen, verified automatically and manually.                                                           |
| **Observability**   | Structured logs with correlation IDs across all boundaries. Alarms per `TECH-STACK.md` §10.                                     |
| **Browser support** | Latest two versions of Chrome, Firefox, Safari, Edge. Responsive from 320px.                                                    |
| **Localisation**    | English only at v1; all user-facing strings externalised so translation is possible without code change.                        |

---

## 20. Acceptance criteria

Grouped by phase. Each is verifiable.

### Phase 0: Foundations

- [ ] `pnpm dev` starts web, API, Postgres, Mongo and LocalStack with one command
- [ ] `packages/core` has zero runtime dependencies beyond `zod` and `date-fns`
- [ ] `apps/web` cannot import from `packages/db`, enforced by an ESLint rule rather than convention
- [ ] Migrations run forward and backward cleanly
- [ ] CI runs lint, typecheck, unit tests and build on every push
- [ ] `cdk synth` succeeds and `cdk-nag` reports no unsuppressed findings
- [ ] A seeded user can log in locally and see an empty dashboard

### Phase 1: Vertical slice

- [ ] A case can be submitted, approved and completed in a deployed environment
- [ ] Every state change writes an audit row in the same transaction
- [ ] The approver receives an email via SNS → SQS → Lambda → SES
- [ ] The notification Lambda is idempotent, proven by a test delivering the same message twice
- [ ] Attempting to fetch another organisation's case by ID returns `404`

### Phase 2: Engine

- [ ] A new process runs from seeded JSON with no code change
- [ ] Condition evaluator coverage above 95%, including every null and missing case in §5.3
- [ ] Engine is pure: its test suite runs with no database and no network
- [ ] An unresolvable assignment sets the case to `unassigned` and emits the event; it does not throw
- [ ] Automatic-step loop guard triggers at 20 iterations

### Phase 3: Form runtime and builder

- [ ] Any valid definition renders as a working form
- [ ] Conditional fields appear and disappear correctly, and are announced to screen readers
- [ ] Every drag operation has a keyboard equivalent, verified by keyboard-only test
- [ ] Error summary appears on validation failure, focus moves to it, each error links to its field
- [ ] `axe-core` reports zero violations on builder and runtime
- [ ] Values persist across validation failure, so nothing is re-typed (SC 3.3.7)

### Phase 4: Workflow builder

- [ ] A complete process can be built in the UI and run without touching JSON
- [ ] Unreachable steps and missing default branches are flagged before publish
- [ ] The list view offers full parity with the canvas for keyboard users

### Phase 5: Versioning and templates

- [ ] **The pinning test:** submit a case, publish a version removing a field the workflow branches on, confirm the in-flight case completes correctly on its original version
- [ ] Published version documents are immutable, so an update attempt is rejected
- [ ] Cloning a template and then editing the template leaves the clone unchanged
- [ ] All six system templates publish and run

### Phase 6: Notifications, SLA, escalation

- [ ] An overdue task escalates automatically, with the escalation audited
- [ ] Escalation adds an assignee rather than replacing one
- [ ] Business-hours SLA calculation excludes weekends and configured holidays
- [ ] Delegation redirects new tasks and records `delegated_from_user_id`
- [ ] A notification outage does not block an approval decision

### Phase 7: Files

- [ ] An EICAR test file is quarantined and permanently undownloadable
- [ ] Download returns `404` while `scanStatus` is `pending`
- [ ] MIME type is validated by content sniffing, not the supplied header
- [ ] Every download writes an audit event

### Phase 8: Reporting

- [ ] Median turnaround and slowest step are visible per process
- [ ] Individual-level views are permission-gated and suppressed below five records
- [ ] Export runs asynchronously and delivers a presigned link

### Phase 9: Administration and hardening

- [ ] Every item in the `GOV-STANDARDS.md` §11 checklist is ticked
- [ ] Cross-tenant test suite covers every endpoint and passes
- [ ] Row-Level Security verified active on every tenant table
- [ ] Retention job redacts expired cases and audits the redaction
- [ ] Subject access export returns complete data for a test subject
- [ ] Load test sustains target throughput within latency budget
- [ ] Manual screen reader test passes on submission and approval journeys
