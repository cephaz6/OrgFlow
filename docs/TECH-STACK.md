# OrgFlow: Tools, Technologies and Concepts

> **Purpose of this document.** A complete inventory of what OrgFlow is built with and *why*. Each entry states the reason it was chosen so the choice is not silently substituted. If a technology is not listed here, it is not in the project. Adding one is an ADR-worthy decision recorded in `documentation/decisions.md`.

---

## 1. Foundational decisions

| Decision | Choice | Rationale |
|---|---|---|
| Language | **TypeScript**, everywhere | One language across web, API, workers and infrastructure. Shared types are the contract that keeps the system coherent. |
| Repository | **Monorepo** (npm workspaces + Turborepo) | Shared types package requires it. Atomic cross-cutting changes. Single CI pipeline. |
| Frontend/backend split | **Next.js frontend + separate Express API** | Clean HTTP boundary forces a real API contract. Lets the API and workers share domain code. Matches the target working environment. |
| Infrastructure | **AWS CDK (TypeScript)** | Infrastructure as real, typed, testable code. Same language as the application. Deepest learning value. |
| Runtime data store | **PostgreSQL** | Cases, tasks, transitions and audit require relational integrity and transactions. |
| Definition store | **MongoDB** | Form and workflow definitions are deeply nested, schemaless and versioned. Genuine document-shaped data. |
| Tenancy model | **Shared database, row-level scoping** | Simpler migrations and operations than schema-per-tenant. The common real-world pattern. Isolation enforced at the repository layer plus RLS. |
| Onboarding | **Self-serve organisation creation, invite-only membership** | Realistic, and makes seeding and demonstration straightforward. |

---

## 2. Monorepo structure

```
org-flow/
├── apps/
│   ├── web/                  # Next.js 15 (App Router): all UI
│   └── api/                  # Express 5: REST API
├── packages/
│   ├── types/                # @orgflow/types: shared contracts. No runtime deps.
│   ├── core/                 # @orgflow/core: pure domain logic (engine, conditions, validation)
│   ├── db/                   # @orgflow/db: Postgres access, migrations, repositories
│   ├── documents/            # @orgflow/documents: Mongo access
│   ├── events/               # @orgflow/events: event definitions and publisher
│   └── ui/                   # @orgflow/ui: shadcn components and design tokens
├── workers/                  # Lambda handlers (notifications, SLA, exports, file scan)
├── infra/                    # AWS CDK application
├── documentation/            # client.md, server.md, decisions.md: living logs
└── docs/                     # This file, PRD.md, PROBLEM-STATEMENT.md, GOV-STANDARDS.md
```

**Dependency direction is strictly one-way:**

```
types  ←  core  ←  db / documents / events  ←  api / workers
   ↑                                              
   └──────────────────  web  ────────────────────┘
```

- `types` depends on nothing.
- `core` is pure: no I/O, no database, no AWS SDK. This is what makes the engine unit-testable without infrastructure.
- `web` depends only on `types` and `ui`. It never imports `db`, `core` internals or server code.

---

## 3. Frontend

| Technology | Version | Why |
|---|---|---|
| **Next.js** | 15.x, App Router | Server Components reduce client bundle. File routing. Strong TypeScript integration. |
| **React** | 19.x | Baseline. |
| **shadcn/ui** | latest | Copy-in components, not a dependency, so accessibility fixes and GDS theming are possible without forking a library. |
| **Radix UI** | via shadcn | The accessibility primitives underneath shadcn. Correct focus management and ARIA out of the box. |
| **Tailwind CSS** | 4.x | Utility styling. Design tokens expressed as CSS custom properties, enabling the GDS theme swap. |
| **TanStack Query** | 5.x | Server state: caching, revalidation, optimistic updates. Approval queues need frequent refresh. |
| **Zustand** | 5.x | Client state for the builder only, because a large, deeply nested editor is painful in Context. |
| **React Hook Form** | 7.x | Form runtime. Uncontrolled by default, so dynamically rendered forms with many fields stay performant. |
| **Zod** | 3.x | Schema validation. Same schemas used client and server via `packages/core`. |
| **dnd-kit** | 6.x | Drag-and-drop for the builder. Chosen specifically because it supports keyboard-operable dragging, which WCAG 2.2 SC 2.5.7 requires. |
| **React Flow** | 12.x | Workflow graph editor. Node/edge canvas with pan, zoom and connection handling already solved. |
| **Lucide React** | latest | Icons. Consistent, tree-shakeable, matches shadcn. |
| **date-fns** | 4.x | Date handling. Modular, immutable, no global patching. |
| **Recharts** | 2.x | Reporting charts. React-native API, reasonable accessibility story. |

**Deliberately excluded**
- Redux: unnecessary given TanStack Query plus Zustand.
- A CSS-in-JS runtime: cost without benefit alongside Tailwind.
- A component library that cannot be modified in place: it would block the GDS theming requirement.

---

## 4. Backend

| Technology | Version | Why |
|---|---|---|
| **Express** | 5.x | Explicitly in the target skill set. Minimal, well-understood, unopinionated. |
| **Zod** | 3.x | Request validation at the boundary. Schemas shared with the frontend. |
| **Passport / openid-client** | latest | OIDC Authorization Code flow with PKCE. Standards-based, IdP-agnostic. |
| **jose** | 5.x | JWT verification and JWKS handling. |
| **Kysely** | 0.27.x | Type-safe SQL query builder. Chosen over a full ORM because the camelCase↔snake_case mapping and mandatory tenant scoping are explicit and inspectable rather than magic. |
| **node-pg-migrate** | 7.x | Versioned, reversible SQL migrations. |
| **pg** | 8.x | Postgres driver. |
| **MongoDB Node Driver** | 6.x | Direct driver rather than Mongoose, because definitions are versioned immutable documents, so a schema layer adds little. |
| **Pino** | 9.x | Structured JSON logging with low overhead. Redaction support for personal data. |
| **Helmet** | 8.x | Security headers. |
| **express-rate-limit** | 7.x | Rate limiting on auth, submission and upload endpoints. |
| **AWS SDK v3** | 3.x | Modular clients: S3, SQS, SNS, EventBridge, Secrets Manager. |
| **@asteasolutions/zod-to-openapi** | latest | Generates OpenAPI 3.1 from Zod schemas. One source of truth for validation and documentation. |

---

## 5. Data stores

### 5.1 PostgreSQL: runtime state

**Holds:** organisations, users, memberships, invitations, IdP configuration, definition registry, cases, tasks, transitions, attachments metadata, notifications ledger, SLA timers, audit events.

**Why:** every one of these needs transactional integrity, foreign keys, and the ability to answer relational questions ("which tasks are overdue across which cases for which approvers").

**Conventions**
- `snake_case` for all identifiers. TypeScript uses `camelCase`; mapping happens in `packages/db` and nowhere else.
- Primary keys are UUID v7, which is time-sortable, so index locality is preserved without exposing sequential counts.
- `organisation_id` on every tenant table, always the first column after the primary key.
- Money as `NUMERIC(20,2)`. Never floating point.
- Timestamps as `TIMESTAMPTZ`, stored UTC.
- Every table carries `created_at`; mutable tables also carry `updated_at`.
- Row-Level Security enabled on all tenant tables, with the tenant set per connection.

**Deployment:** RDS PostgreSQL 16 (`db.t4g.micro` for development).

### 5.2 MongoDB: definitions and values

**Holds:** process definition documents (form schema + workflow graph, one immutable document per published version), templates, submitted case values.

**Why:** a form definition is an arbitrarily nested tree whose shape changes with every field type added. Modelling it relationally means either a rigid schema that constrains the product or an EAV table that is painful to query. Definitions are also *write-once, read-many*, a natural document fit.

**Conventions**
- `camelCase` throughout. No mapping layer; these are TypeScript objects persisted directly.
- `organisationId` on every document, indexed.
- Published version documents are **immutable**. A change creates a new document, never an update.

**Deployment:** MongoDB Atlas free tier for development. DocumentDB is an option in AWS-only environments but is not API-complete. That is noted as a constraint, not a plan.

### 5.3 S3: files

**Holds:** case attachments, generated exports, organisation branding assets.

**Key structure:** `{organisationId}/cases/{caseId}/{attachmentId}/{filename}`

**Rules**
- Uploads via presigned POST with content-length and content-type conditions.
- Downloads via presigned GET, expiry ≤ 15 minutes.
- Bucket fully private, block public access enabled.
- Versioning on. Lifecycle policy transitions exports to cheaper storage and expires them.
- Server-side encryption with KMS.

---

## 6. Asynchronous processing

| Service | Use |
|---|---|
| **SQS** | Work queues for notification dispatch, export generation and file post-processing. Each with a dead letter queue. |
| **SNS** | Domain event fan-out. The API publishes to a topic; multiple queues subscribe. Adding a consumer requires no API change. |
| **EventBridge Scheduler** | SLA timers. One-off schedules created when a task is assigned, fired at the due time. Chosen over SQS delayed messages because the 15-minute delay ceiling on SQS cannot express a 5-day SLA. |
| **Lambda** | All queue consumers and scheduled handlers. Node.js 22 runtime, ARM64. |
| **Step Functions** | *Not used.* The workflow engine is application logic operating on persisted state, not an AWS state machine, because the workflow definition is tenant-authored data, which Step Functions cannot express. Recorded here so it is not proposed again. |

**Event flow**

```
API records state change (Postgres transaction)
      ↓
Publishes domain event → SNS topic
      ↓
   ┌──┴────────────┬──────────────┬─────────────┐
notifications    audit          analytics     webhooks
   SQS            SQS             SQS           SQS
   ↓               ↓               ↓             ↓
 Lambda          Lambda          Lambda        Lambda
   ↓
 SES / in-app
```

**Non-negotiable rule:** the workflow engine performs no I/O beyond its own state transition. It emits events. Everything reactive (notifications, escalations, analytics, webhooks) subscribes. This is what allows new channels to be added without touching the engine.

---

## 7. Infrastructure: AWS CDK

**Stacks**

| Stack | Contents |
|---|---|
| `NetworkStack` | VPC, subnets, security groups, VPC endpoints |
| `DataStack` | RDS Postgres, S3 buckets, KMS keys, Secrets Manager |
| `MessagingStack` | SNS topics, SQS queues, DLQs, EventBridge schedule group |
| `ApiStack` | API compute (Lambda + API Gateway, or ECS Fargate), IAM roles |
| `WorkersStack` | Lambda functions, event source mappings |
| `WebStack` | Next.js hosting, CloudFront, ACM certificate |
| `ObservabilityStack` | Log groups, metric filters, alarms, dashboard |

**Practices**
- Environment configuration via CDK context, never hard-coded.
- `cdk-nag` with AWS Solutions rules applied; suppressions require a written justification.
- Snapshot tests on synthesised templates so infrastructure changes are visible in review.
- Least-privilege IAM. No wildcard resource ARNs.
- Every stack tagged with project, environment and owner.

**Local development**
- **LocalStack** emulates S3, SQS, SNS and EventBridge.
- **Docker Compose** runs Postgres and MongoDB.
- One command (`npm run dev`) starts everything.

---

## 8. Testing

| Layer | Tool | Target |
|---|---|---|
| Unit | **Vitest** | `packages/core`: engine, condition evaluator, validators. Target 90%+ coverage. This is pure logic with no I/O, so there is no excuse for gaps. |
| Integration | **Vitest + Testcontainers** | Repositories against real Postgres and Mongo. Never mock the database. |
| Contract | **Vitest + supertest** | API endpoints against the OpenAPI schema. |
| AWS integration | **LocalStack** | Queue consumers, S3 flows, event publication. |
| E2E | **Playwright** | Full journeys: submit, approve, escalate, complete. |
| Accessibility | **axe-core / @axe-core/playwright** | Every primary page. CI fails on any violation. |
| Load | **k6** | Submission and approval endpoints under concurrency. |
| Security | **npm audit, Trivy, Gitleaks** | Dependencies, container images, secrets. |

**Mandatory test categories**

1. **Cross-tenant isolation.** For every endpoint, attempt access to another organisation's resource by ID and assert `404`.
2. **Version pinning.** Submit a case, publish a new definition version, assert the in-flight case still executes the old version.
3. **Idempotency.** Deliver every queue message twice, assert a single effect.
4. **Condition evaluation.** Table-driven tests across every operator, including null and missing-field behaviour.

---

## 9. CI/CD: GitHub Actions

**Pipeline**

```
push / pull request
  ├─ lint (ESLint, Prettier, tsc --noEmit)
  ├─ unit tests
  ├─ integration tests (Testcontainers)
  ├─ build all packages
  ├─ E2E tests (Playwright + axe)
  ├─ security scan (audit, Trivy, Gitleaks)
  ├─ cdk synth + cdk-nag
  └─ [main only] deploy dev → smoke test → deploy staging
```

**Practices**
- Turborepo remote caching, so only affected packages rebuild.
- Branch protection on `main`: tests must pass.
- Conventional Commits, enforced by commitlint.
- Changesets for versioning shared packages.
- Deployment via GitHub OIDC to AWS. No long-lived access keys.

---

## 10. Observability

| Concern | Tool |
|---|---|
| Logs | CloudWatch Logs, structured JSON via Pino |
| Metrics | CloudWatch, custom metrics via Embedded Metric Format |
| Tracing | AWS X-Ray, with correlation IDs propagated across HTTP, SNS and SQS |
| Errors | Sentry (optional; CloudWatch alarms are the baseline) |
| Dashboards | CloudWatch Dashboard defined in CDK |

**Alarms**
- API 5xx rate above threshold
- API p95 latency above threshold
- Any DLQ depth above zero
- Notification delivery failure rate
- Database connection saturation
- Oldest message age on any queue

---

## 11. Core concepts

These are the ideas the codebase is built on. An agent working on OrgFlow must understand each.

### 11.1 The template / definition / case triad

Three distinct things that are easy to conflate. The distinction is load-bearing.

- **Template.** A reusable blueprint. Not runnable. Scoped as *system* (shipped with OrgFlow, read-only, available to all), *organisation* (an org's own saved blueprint), or *published* (shared to a public library). Cloning a template produces a definition.
- **Definition.** A live, versioned, runnable process belonging to exactly one organisation. It has a form schema and a workflow graph.
- **Case.** A single running instance of one specific *version* of a definition.

**Cloning is a hard copy.** A definition created from a template carries no reference back to it. Later edits to the template never affect definitions already cloned. Same reasoning as version pinning.

### 11.2 Version pinning

The single most important correctness property in the product.

- Definitions are versioned. Publishing creates a new immutable version.
- A case records the exact `version_id` it was submitted against.
- The engine always executes the case's pinned version, never the current one.
- If it did otherwise, a form edit could remove a field an in-flight case depends on, or an added approval step could apply retroactively to a decision already taken. Either makes the audit trail a lie.

### 11.3 The condition expression language

A declarative JSON AST, interpreted by a pure function in `packages/core`.

```json
{
  "all": [
    { "field": "cost", "operator": "gt", "value": 1000 },
    { "any": [
      { "field": "department", "operator": "eq", "value": "engineering" },
      { "field": "urgent", "operator": "eq", "value": true }
    ]}
  ]
}
```

- **Never `eval`.** Never a templating engine with code execution. Tenant-authored expressions are untrusted input.
- The same evaluator powers builder preview, form runtime field visibility, and workflow branching. One implementation, three consumers.
- Explicitly defined behaviour for null and missing fields, the most common source of workflow bugs.

### 11.4 The workflow engine as a pure state machine

- Input: current case state, pinned definition version, and a triggering event.
- Output: next state, tasks to create, events to emit.
- **No I/O.** No database calls, no HTTP, no AWS SDK. The caller persists the result.
- This makes the hardest logic in the product testable in milliseconds without infrastructure, and it is why `packages/core` has no runtime dependencies.

### 11.5 Event-driven side effects

The engine emits; everything else subscribes. Notifications, SLA timers, analytics and webhooks are consumers. Adding a fifth consumer must require zero changes to the engine.

### 11.6 Tenant isolation as a data-layer property

Scoping is not a route-handler responsibility. The repository layer physically cannot construct an unscoped query, and Row-Level Security is a second line of defence. Any code path where a developer *could* forget a tenant filter is a defect in the abstraction.

### 11.7 Append-only audit

Audit rows are inserted, never updated or deleted, and this is enforced by database grants rather than convention. Written in the same transaction as the change they record, so an audit gap is impossible by construction.

### 11.8 Assignment resolution

Deciding *who* a task goes to. Strategies:

- `specificUser`: a named person
- `role`: anyone holding a role within the organisation
- `lineManager`: resolved from the requester's manager relationship
- `submitter`: back to the person who raised it
- `fieldReference`: a person selected in a form field
- `group`: a defined group, with claim-based ownership

Resolution happens at task creation and the outcome is persisted. If the resolver produces nobody, the case enters an explicit `unassigned` state requiring administrative intervention. It does not fail silently.

### 11.9 Optimistic concurrency

Two approvers acting on the same task simultaneously must not both succeed. Cases and tasks carry a version column; updates assert the expected version and fail with a conflict if it has moved.

### 11.10 Idempotency

SQS delivers at least once. Every consumer must produce the same result when a message is delivered twice, enforced via an idempotency key table or a natural uniqueness constraint. Tested explicitly.

---

## 12. Naming conventions

**Non-negotiable and consistent across the project.**

| Context | Convention | Example |
|---|---|---|
| TypeScript variables, functions, properties | `camelCase` | `organisationId`, `resolveAssignee` |
| TypeScript types, interfaces, classes | `PascalCase` | `ProcessDefinition`, `CaseTask` |
| TypeScript constants | `SCREAMING_SNAKE_CASE` | `MAX_UPLOAD_BYTES` |
| Postgres tables, columns | `snake_case` | `case_tasks`, `organisation_id` |
| Postgres table names | plural, lowercase | `cases`, `audit_events` |
| MongoDB collections | `camelCase`, plural | `processDefinitions` |
| MongoDB fields | `camelCase` | `organisationId` |
| API routes | `kebab-case`, plural | `/api/v1/process-definitions` |
| API JSON keys | `camelCase` | `{ "organisationId": "..." }` |
| Files, components | `PascalCase.tsx` | `ApprovalQueue.tsx` |
| Files, everything else | `kebab-case.ts` | `resolve-assignee.ts` |
| Directories | `kebab-case` | `process-definitions/` |
| Environment variables | `SCREAMING_SNAKE_CASE`, `ORGFLOW_` prefix | `ORGFLOW_DATABASE_URL` |
| Events | `dot.case`, past tense | `case.submitted`, `task.escalated` |
| Git branches | `type/short-description` | `feat/workflow-engine` |
| CDK constructs | `PascalCase` | `NotificationQueue` |

**The one mapping boundary:** `camelCase` in TypeScript ↔ `snake_case` in Postgres, translated in `packages/db` and nowhere else. Mongo requires no mapping; it stores TypeScript objects as they are.

---

## 13. Package reference

**Root**
```
turbo, typescript, eslint, prettier, husky, lint-staged,
commitlint, @changesets/cli, vitest
```

**apps/web**
```
next, react, react-dom, @tanstack/react-query, zustand,
react-hook-form, @hookform/resolvers, zod, @dnd-kit/core,
@dnd-kit/sortable, @xyflow/react, lucide-react, date-fns,
recharts, tailwindcss, class-variance-authority, clsx,
tailwind-merge, @radix-ui/* (via shadcn)
```

**apps/api**
```
express, zod, kysely, pg, mongodb, openid-client, jose,
pino, pino-http, helmet, cors, express-rate-limit,
cookie-parser, @aws-sdk/client-s3, @aws-sdk/client-sqs,
@aws-sdk/client-sns, @aws-sdk/client-scheduler,
@aws-sdk/client-secrets-manager, @aws-sdk/s3-request-presigner,
@asteasolutions/zod-to-openapi
```

**packages/core:** `zod` and `date-fns` only. No I/O dependencies, ever.

**infra:** `aws-cdk-lib`, `constructs`, `cdk-nag`

**workers:** `@aws-sdk/*`, `pino`, `@aws-sdk/client-sesv2`, `nodemailer`

**Dev and test:** `vitest`, `@vitest/coverage-v8`, `testcontainers`, `@playwright/test`, `@axe-core/playwright`, `supertest`, `msw`, `k6`

---

## 14. Learning map

Which part of the build exercises which target skill.

| Target skill | Where it is exercised |
|---|---|
| TypeScript at depth | Shared types, discriminated unions for step and field types, generics in the repository layer |
| React / Next.js | Form builder, workflow canvas, approval queue, Server Components, streaming |
| Node.js / Express | API, middleware pipeline, auth, error handling |
| AWS Lambda | Every async worker |
| AWS S3 | Presigned uploads, virus scanning pipeline, exports |
| AWS SQS | Notification, export and file-processing queues; DLQs; idempotency |
| AWS SNS | Domain event fan-out |
| AWS API Gateway | API fronting, throttling, authorisation |
| AWS EventBridge | SLA timers and escalation scheduling |
| PostgreSQL | Relational modelling, transactions, RLS, migrations, indexing |
| MongoDB | Document modelling, versioned immutable documents, aggregation for reporting |
| Automated testing in CI/CD | Full pyramid in GitHub Actions, LocalStack, Testcontainers |
| Infrastructure as code | CDK across seven stacks |
| Agile delivery | Vertical slices, incremental phases, working software each increment |
| Accessibility | WCAG 2.2 AA including the genuinely hard drag-and-drop case |
| Multi-tenancy | Isolation at data layer plus RLS, with an adversarial test suite |
