# OrgFlow

A multi-tenant internal workflow platform. Organisations define a form and an
approval chain, and OrgFlow runs the process: routing, chasing, tracking and
auditing it.

---

## Contents

- [The problem](#the-problem)
- [What OrgFlow does](#what-orgflow-does)
- [Tech stack](#tech-stack)
- [Repository structure](#repository-structure)
- [Getting started](#getting-started)
- [Available scripts](#available-scripts)
- [Testing](#testing)
- [Documentation](#documentation)
- [Licence](#licence)

---

## The problem

Inside almost every organisation there is a long tail of routine internal
processes, such as system access requests, equipment orders, expense approvals
and new starter onboarding, which run on email, shared spreadsheets and
institutional memory. Requesters cannot see the rules they are judged against or
the status of what they submitted, so chasing becomes the only tracking
mechanism they have. Approvers work from an inbox where a request waiting nine
days looks identical to one that arrived this morning, and their approval
survives only as a sentence in an email. Process owners cannot answer basic
questions about their own process, cannot change it safely, and cannot evidence
what happened when an auditor asks.

These processes are structurally identical. Each is a structured form, followed
by a conditional sequence of approvals, producing an auditable record. The only
thing that differs between any two of them is the fields collected and the
routing rules applied, which are precisely the two things the process owner
already knows and could specify themselves, given somewhere to specify them.

Full detail is in [docs/PROBLEM-STATEMENT.md](docs/PROBLEM-STATEMENT.md).

## What OrgFlow does

A process owner builds a form (fields, validation, conditional visibility) and a
workflow (approval steps, routing rules, deadlines) in the browser, without
writing code. OrgFlow then runs it: resolving each step to the right approver,
notifying and reminding them, escalating when a deadline passes, tracking live
status for the requester, and recording an append-only audit trail of every
decision.

Three concepts govern the whole design, and conflating them is the most common
way to get this wrong.

| Concept        | What it is                                                                                                                                          | Runnable | Versioned |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------- |
| **Template**   | A reusable blueprint, scoped as a system template shipped with OrgFlow, an organisation's own saved blueprint, or one published to a shared library | No       | No        |
| **Definition** | A live process belonging to exactly one organisation, with a form schema and a workflow graph                                                       | Yes      | Yes       |
| **Case**       | A single running instance of one specific _version_ of a definition                                                                                 | n/a      | Pinned    |

Two properties follow from this, and both are load-bearing:

- **Cloning is a hard copy.** A definition created from a template keeps no
  reference back to it. Later edits to the template never reach definitions
  already cloned.
- **Version pinning.** A case records the exact version it was submitted against
  and executes that version forever. Publishing a new version never affects a
  case already in flight. Without this, a form edit could remove a field a
  running case depends on, or a new approval step could apply retroactively to a
  decision already taken, and the audit trail would become a lie.

## Tech stack

Every entry below was chosen deliberately. The reasoning for each is in
[docs/TECH-STACK.md](docs/TECH-STACK.md); substituting one is an architectural
decision, recorded in [documentation/decisions.md](documentation/decisions.md)
and agreed first.

| Area             | Technology                                       | Why                                                                                                                                               |
| ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Language         | TypeScript                                       | One language across web, API, workers and infrastructure. Shared types are the contract holding the system together.                              |
| Repository       | npm workspaces with Turborepo                    | A shared types package requires a monorepo. Atomic cross-cutting changes, one CI pipeline.                                                        |
| Web              | Next.js 15 (App Router), React 19                | Server Components reduce the client bundle. File routing, strong TypeScript integration.                                                          |
| UI               | shadcn/ui on Radix, Tailwind CSS 4               | Copy-in components that can be modified in place, which is what makes a GOV.UK theme possible without forking a library.                          |
| Typography       | Google Fonts via `next/font/google`              | Self-hosted and subset at build time, exposed as design tokens so a theme swap replaces them.                                                     |
| Client state     | TanStack Query, Zustand                          | Server state and cache revalidation for queues; local store for the builder only.                                                                 |
| Forms            | React Hook Form, Zod                             | Uncontrolled by default, so a dynamically rendered form with many fields stays responsive.                                                        |
| Builders         | dnd-kit, React Flow                              | dnd-kit supports keyboard-operable dragging, which WCAG 2.2 SC 2.5.7 requires.                                                                    |
| API              | Express 5                                        | A clean HTTP boundary that forces a real API contract, and lets the API and workers share domain code.                                            |
| Validation       | Zod, with `zod-to-openapi`                       | One schema drives request validation and the published OpenAPI 3.1 document.                                                                      |
| Auth             | `openid-client`, `jose`                          | OIDC Authorization Code flow with PKCE. Standards-based and identity-provider agnostic.                                                           |
| Runtime data     | PostgreSQL 16 via Kysely and `node-pg-migrate`   | Cases, tasks, transitions and audit need transactions and referential integrity. A query builder keeps tenant scoping explicit rather than magic. |
| Definition store | MongoDB via the official driver                  | A form definition is a deeply nested tree, written once and read many times. Genuinely document-shaped data.                                      |
| Files            | S3                                               | Presigned upload and download, private bucket, asynchronous virus scanning.                                                                       |
| Async            | SQS, SNS, EventBridge Scheduler, Lambda          | Event fan-out for notifications and analytics; one-off schedules for SLA timers, which SQS delay cannot express.                                  |
| Infrastructure   | AWS CDK with `cdk-nag`                           | Infrastructure as typed, testable code in the same language as the application.                                                                   |
| Logging          | Pino                                             | Structured JSON logs with redaction support for personal data.                                                                                    |
| Testing          | Vitest, Testcontainers, Playwright, axe-core, k6 | Real databases in integration tests, real browsers in end-to-end tests, accessibility as a CI gate.                                               |
| CI/CD            | GitHub Actions                                   | Lint, typecheck, test, build, security scan and `cdk synth` on every push.                                                                        |

## Repository structure

```
org-flow/
├── apps/
│   ├── web/          Next.js application. All UI.
│   └── api/          Express REST API.
├── packages/
│   ├── types/        @orgflow/types. Shared contracts. No runtime dependencies.
│   ├── core/         @orgflow/core. Pure domain logic: engine, conditions, validation.
│   ├── db/           @orgflow/db. Postgres access, migrations, repositories.
│   ├── documents/    @orgflow/documents. Mongo access.
│   ├── events/       @orgflow/events. Event definitions and publisher.
│   └── ui/           @orgflow/ui. shadcn components and design tokens.
├── workers/          Lambda handlers: notifications, SLA, exports, file scanning.
├── infra/            AWS CDK application.
├── docs/             Specification: problem, standards, stack, PRD.
└── documentation/    Living logs: client.md, server.md, decisions.md.
```

Dependencies run in one direction only:

```
types  ←  core  ←  db / documents / events  ←  api / workers
   ↑
   └──────────────────  web  ────────────────────┘
```

`packages/core` performs no I/O at all: no database, no HTTP, no AWS SDK, and no
reading of the clock. Time is injected. This is what makes the hardest logic in
the product testable in milliseconds without infrastructure. `apps/web` imports
only `types` and `ui`, never server code. Both rules are enforced by ESLint, and
breaking either is a defect even when it compiles.

## Getting started

### Prerequisites

| Requirement    | Version     | Notes                                                            |
| -------------- | ----------- | ---------------------------------------------------------------- |
| Node.js        | 22 LTS      | Matches the Lambda runtime.                                      |
| npm            | 10 or later | Workspaces are used; do not substitute another package manager.  |
| Docker Desktop | Current     | Runs Postgres, MongoDB and LocalStack, and backs Testcontainers. |
| AWS CLI        | v2          | Only needed for deployment.                                      |
| Git            | Current     |                                                                  |

### Install

```bash
git clone https://github.com/cephaz6/OrgFlow.git
cd OrgFlow
npm install
```

### Configuration

```bash
cp .env.example .env
```

All configuration arrives through environment variables, every one prefixed
`ORGFLOW_`. Three rules govern how they are handled, and they are recorded as
ADR-0001 in [decisions.md](documentation/decisions.md).

**`.env.example` is the source of truth for what exists.** It is committed, it
lists every variable the application reads, and it explains what each is for.
This README deliberately does not repeat that inventory, because a second copy
of a list is a copy that goes stale. Read the file.

**Configuration is validated once, at boot.** Each application parses its
environment against a Zod schema and exports a typed, frozen object. If anything
is missing or malformed, startup fails immediately and names the offending
variable, rather than surfacing as an undefined value three layers deep at
request time. `process.env` is read nowhere else, and ESLint enforces that.

**Deployed environments do not use `.env` at all.** Configuration and secrets
come from AWS Secrets Manager and Parameter Store, injected at runtime. No
secret is committed, logged or printed, and Pino redaction covers the keys that
carry them.

The variables fall into six groups: runtime identity, datastore connections,
session signing, AWS resources and endpoints, identity provider credentials, and
the single browser-exposed value. Only variables prefixed `NEXT_PUBLIC_` reach
the client, each declared deliberately; the environment is never spread into
client code.

Two values deserve particular care. `ORGFLOW_SESSION_SECRET` is load-bearing, so
rotating it signs every user out. The datastore credentials in `.env.example`
belong to throwaway Docker containers bound to localhost, and must never be
repointed at a shared or deployed database.

### Running locally

```bash
npm run dev
```

One command starts everything: Postgres, MongoDB and LocalStack in Docker,
migrations, the seed script, the API and the web application.

| Service       | Address                      |
| ------------- | ---------------------------- |
| Web           | http://localhost:3000        |
| API           | http://localhost:4000        |
| API health    | http://localhost:4000/health |
| API readiness | http://localhost:4000/ready  |
| Postgres      | localhost:5432               |
| MongoDB       | localhost:27017              |
| LocalStack    | http://localhost:4566        |

Sign in with a seeded account from the development login. That path is guarded
by `ORGFLOW_ENV` and by the absence of a deployed-environment marker, and it
fails closed, so it cannot be enabled outside local development.

## Available scripts

Run from the repository root. Turborepo runs each task only for the packages
affected by a change.

| Script                     | Does                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------ |
| `npm run dev`              | Starts the full local stack: containers, migrations, seed, API and web.              |
| `npm run build`            | Builds every package and application in dependency order.                            |
| `npm run lint`             | ESLint across the workspace, including the dependency-direction rule and `jsx-a11y`. |
| `npm run typecheck`        | `tsc --noEmit` across every package.                                                 |
| `npm run format`           | Prettier, writing changes in place.                                                  |
| `npm run test`             | Unit tests (Vitest).                                                                 |
| `npm run test:integration` | Integration tests against real Postgres and Mongo via Testcontainers.                |
| `npm run test:e2e`         | Playwright end-to-end suite, including the axe-core accessibility checks.            |
| `npm run test:coverage`    | Coverage report. `packages/core` must stay above 90%.                                |
| `npm run db:migrate`       | Applies pending Postgres migrations.                                                 |
| `npm run db:rollback`      | Reverts the most recent migration.                                                   |
| `npm run db:seed`          | Seeds development organisations, users and definitions.                              |
| `npm run docker:up`        | Starts the Docker services alone.                                                    |
| `npm run docker:down`      | Stops them and removes volumes.                                                      |
| `npm run cdk:synth`        | Synthesises the CDK application and runs `cdk-nag`.                                  |
| `npm run cdk:diff`         | Diffs synthesised infrastructure against the deployed stack.                         |

## Testing

Tests are written with the code, not after it. A feature whose tests are
outstanding is not finished.

| Layer         | Tool                       | Scope                                                                                                                                                        |
| ------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit          | Vitest                     | `packages/core`: the engine, condition evaluator and validators. Above 90% coverage, because this is pure logic with no I/O and there is no excuse for gaps. |
| Integration   | Vitest with Testcontainers | Repositories against real Postgres and Mongo. The database is never mocked.                                                                                  |
| Contract      | Vitest with supertest      | API endpoints checked against the OpenAPI schema.                                                                                                            |
| AWS           | LocalStack                 | Queue consumers, S3 flows and event publication.                                                                                                             |
| End to end    | Playwright                 | Complete journeys: submit, approve, escalate, complete.                                                                                                      |
| Accessibility | axe-core via Playwright    | Every primary page. CI fails on any violation.                                                                                                               |
| Load          | k6                         | Submission and approval endpoints under concurrency.                                                                                                         |
| Security      | npm audit, Trivy, Gitleaks | Dependencies, images and secrets.                                                                                                                            |

Four categories of test are mandatory, because each guards a property that is
expensive to lose:

1. **Cross-tenant isolation.** For every endpoint, request another
   organisation's resource by identifier and assert `404`. Never `403`, because
   a `403` confirms the resource exists.
2. **Version pinning.** Submit a case, publish a breaking change to the
   definition, and assert the in-flight case still completes correctly on its
   original version.
3. **Idempotency.** Deliver every queue message twice and assert a single
   effect. SQS delivers at least once.
4. **Condition evaluation.** Table-driven tests across every operator, including
   every null and missing-field case.

Accessibility is a completion criterion rather than a follow-up ticket. WCAG 2.2
AA applies to every screen, every drag interaction has a keyboard equivalent,
and status is never conveyed by colour alone.

## Documentation

### Specification, in `docs/`

Read in this order. These define the product and do not change casually.

| Document                                          | Holds                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| [PROBLEM-STATEMENT.md](docs/PROBLEM-STATEMENT.md) | Why OrgFlow exists. Every technical decision should trace back to a problem described here.                   |
| [GOV-STANDARDS.md](docs/GOV-STANDARDS.md)         | The quality bar: WCAG 2.2 AA, security, UK GDPR, operational standards, and the release compliance checklist. |
| [TECH-STACK.md](docs/TECH-STACK.md)               | Every technology and the reason it was chosen, plus the core concepts the codebase is built on.               |
| [PRD-SUMMARY.md](docs/PRD-SUMMARY.md)             | Scope, the phase-by-phase build sequence, and the rules of engagement.                                        |
| [PRD.md](docs/PRD.md)                             | The full specification: data models, engine semantics, API surface, screens, acceptance criteria.             |

## Licence

MIT. See [LICENSE](LICENSE).
