# OrgFlow

A multi-tenant internal workflow platform. Organisations define a form and an approval chain, and OrgFlow runs the process: routing, chasing, tracking and auditing it.

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
- [Project status](#project-status)
- [Contributing](#contributing)
- [Licence](#licence)

---

## The problem

Inside almost every organisation there is a long tail of routine internal processes, such as system access requests, equipment orders, expense approvals and new starter onboarding, which run on email, shared spreadsheets and institutional memory. Requesters cannot see the rules they are judged against or the status of what they submitted, so chasing becomes the only tracking mechanism they have. Approvers work from an inbox where a request waiting nine days looks identical to one that arrived this morning, and their approval survives only as a sentence in an email. Process owners cannot answer basic questions about their own process, cannot change it safely, and cannot evidence what happened when an auditor asks.

These processes are structurally identical. Each is a structured form, followed by a conditional sequence of approvals, producing an auditable record. The only thing that differs between any two of them is the fields collected and the routing rules applied, which are precisely the two things the process owner already knows and could specify themselves, given somewhere to specify them.

Full detail is in [docs/PROBLEM-STATEMENT.md](docs/PROBLEM-STATEMENT.md).

## What OrgFlow does

A process owner builds a form (fields, validation, conditional visibility) and a workflow (approval steps, routing rules, deadlines) in the browser, without writing code. OrgFlow then runs it: resolving each step to the right approver, notifying and reminding them, escalating when a deadline passes, tracking live status for the requester, and recording an append-only audit trail of every decision.

Three concepts govern the whole design, and conflating them is the most common way to get this wrong.

| Concept | What it is | Runnable | Versioned |
|---|---|---|---|
| **Template** | A reusable blueprint, scoped as a system template shipped with OrgFlow, an organisation's own saved blueprint, or one published to a shared library | No | No |
| **Definition** | A live process belonging to exactly one organisation, with a form schema and a workflow graph | Yes | Yes |
| **Case** | A single running instance of one specific *version* of a definition | n/a | Pinned |

Two properties follow from this, and both are load-bearing:

- **Cloning is a hard copy.** A definition created from a template keeps no reference back to it. Later edits to the template never reach definitions already cloned.
- **Version pinning.** A case records the exact version it was submitted against and executes that version forever. Publishing a new version never affects a case already in flight. Without this, a form edit could remove a field a running case depends on, or a new approval step could apply retroactively to a decision already taken, and the audit trail would become a lie.

## Tech stack

Every entry below was chosen deliberately. The reasoning for each is in [docs/TECH-STACK.md](docs/TECH-STACK.md); substituting one is an architectural decision, recorded in [documentation/decisions.md](documentation/decisions.md) and agreed first.

| Area | Technology | Why |
|---|---|---|
| Language | TypeScript | One language across web, API, workers and infrastructure. Shared types are the contract holding the system together. |
| Repository | npm workspaces with Turborepo | A shared types package requires a monorepo. Atomic cross-cutting changes, one CI pipeline. |
| Web | Next.js 15 (App Router), React 19 | Server Components reduce the client bundle. File routing, strong TypeScript integration. |
| UI | shadcn/ui on Radix, Tailwind CSS 4 | Copy-in components that can be modified in place, which is what makes a GOV.UK theme possible without forking a library. |
| Typography | Google Fonts via `next/font/google` | Self-hosted and subset at build time, exposed as design tokens so a theme swap replaces them. |
| Client state | TanStack Query, Zustand | Server state and cache revalidation for queues; local store for the builder only. |
| Forms | React Hook Form, Zod | Uncontrolled by default, so a dynamically rendered form with many fields stays responsive. |
| Builders | dnd-kit, React Flow | dnd-kit supports keyboard-operable dragging, which WCAG 2.2 SC 2.5.7 requires. |
| API | Express 5 | A clean HTTP boundary that forces a real API contract, and lets the API and workers share domain code. |
| Validation | Zod, with `zod-to-openapi` | One schema drives request validation and the published OpenAPI 3.1 document. |
| Auth | `openid-client`, `jose` | OIDC Authorization Code flow with PKCE. Standards-based and identity-provider agnostic. |
| Runtime data | PostgreSQL 16 via Kysely and `node-pg-migrate` | Cases, tasks, transitions and audit need transactions and referential integrity. A query builder keeps tenant scoping explicit rather than magic. |
| Definition store | MongoDB via the official driver | A form definition is a deeply nested tree, written once and read many times. Genuinely document-shaped data. |
| Files | S3 | Presigned upload and download, private bucket, asynchronous virus scanning. |
| Async | SQS, SNS, EventBridge Scheduler, Lambda | Event fan-out for notifications and analytics; one-off schedules for SLA timers, which SQS delay cannot express. |
| Infrastructure | AWS CDK with `cdk-nag` | Infrastructure as typed, testable code in the same language as the application. |
| Logging | Pino | Structured JSON logs with redaction support for personal data. |
| Testing | Vitest, Testcontainers, Playwright, axe-core, k6 | Real databases in integration tests, real browsers in end-to-end tests, accessibility as a CI gate. |
| CI/CD | GitHub Actions | Lint, typecheck, test, build, security scan and `cdk synth` on every push. |

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

`packages/core` performs no I/O at all: no database, no HTTP, no AWS SDK, and no reading of the clock. Time is injected. This is what makes the hardest logic in the product testable in milliseconds without infrastructure. `apps/web` imports only `types` and `ui`, never server code. Both rules are enforced by ESLint, and breaking either is a defect even when it compiles.

## Getting started

### Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 22 LTS | Matches the Lambda runtime. |
| npm | 10 or later | Workspaces are used; do not substitute another package manager. |
| Docker Desktop | Current | Runs Postgres, MongoDB and LocalStack, and backs Testcontainers. |
| AWS CLI | v2 | Only needed for deployment. |
| Git | Current | |

### Install

```bash
git clone https://github.com/cephaz6/OrgFlow.git
cd OrgFlow
npm install
```

### Environment variables

Copy the example file and edit it. Every variable is prefixed `ORGFLOW_`. The file is gitignored and no secret belongs anywhere else in the repository.

```bash
cp .env.example .env
```

| Variable | Example | Purpose |
|---|---|---|
| `ORGFLOW_ENV` | `local` | Environment marker. The seeded development login is refused unless this is `local`, and it fails closed. |
| `ORGFLOW_API_PORT` | `4000` | Port the Express API listens on. |
| `ORGFLOW_WEB_URL` | `http://localhost:3000` | Used for callback URLs and notification links. |
| `ORGFLOW_DATABASE_URL` | `postgres://orgflow:orgflow@localhost:5432/orgflow` | Postgres connection string. |
| `ORGFLOW_MONGODB_URI` | `mongodb://localhost:27017/orgflow` | MongoDB connection string. |
| `ORGFLOW_SESSION_SECRET` | *(generated)* | Signs the session cookie. Generate a fresh value locally; never reuse one across environments. |
| `ORGFLOW_AWS_REGION` | `eu-west-2` | Default region. London by default, for data residency. |
| `ORGFLOW_AWS_ENDPOINT` | `http://localhost:4566` | LocalStack endpoint. Leave unset in a deployed environment. |
| `ORGFLOW_S3_BUCKET` | `orgflow-local-attachments` | Attachment bucket. |
| `ORGFLOW_EVENTS_TOPIC_ARN` | *(from LocalStack)* | SNS topic domain events publish to. |
| `ORGFLOW_OIDC_ISSUER_URL` | *(provider specific)* | Optional locally. Without it, use the seeded development login. |
| `ORGFLOW_OIDC_CLIENT_ID` | *(provider specific)* | Optional locally. |
| `ORGFLOW_LOG_LEVEL` | `debug` | Pino log level. |
| `NEXT_PUBLIC_ORGFLOW_API_URL` | `http://localhost:4000/api/v1` | The only variable exposed to the browser. Next.js requires the `NEXT_PUBLIC_` prefix. |

In a deployed environment, secrets come from AWS Secrets Manager or Parameter Store. They are never committed, never logged and never printed.

### Running locally

```bash
npm run dev
```

One command starts everything: Postgres, MongoDB and LocalStack in Docker, migrations, the seed script, the API and the web application.

| Service | Address |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:4000 |
| API health | http://localhost:4000/health |
| API readiness | http://localhost:4000/ready |
| Postgres | localhost:5432 |
| MongoDB | localhost:27017 |
| LocalStack | http://localhost:4566 |

Sign in with a seeded account from the development login. That path is guarded by `ORGFLOW_ENV` and by the absence of a deployed-environment marker, and it fails closed, so it cannot be enabled outside local development.

## Available scripts

Run from the repository root. Turborepo runs each task only for the packages affected by a change.

| Script | Does |
|---|---|
| `npm run dev` | Starts the full local stack: containers, migrations, seed, API and web. |
| `npm run build` | Builds every package and application in dependency order. |
| `npm run lint` | ESLint across the workspace, including the dependency-direction rule and `jsx-a11y`. |
| `npm run typecheck` | `tsc --noEmit` across every package. |
| `npm run format` | Prettier, writing changes in place. |
| `npm run test` | Unit tests (Vitest). |
| `npm run test:integration` | Integration tests against real Postgres and Mongo via Testcontainers. |
| `npm run test:e2e` | Playwright end-to-end suite, including the axe-core accessibility checks. |
| `npm run test:coverage` | Coverage report. `packages/core` must stay above 90%. |
| `npm run db:migrate` | Applies pending Postgres migrations. |
| `npm run db:rollback` | Reverts the most recent migration. |
| `npm run db:seed` | Seeds development organisations, users and definitions. |
| `npm run docker:up` | Starts the Docker services alone. |
| `npm run docker:down` | Stops them and removes volumes. |
| `npm run cdk:synth` | Synthesises the CDK application and runs `cdk-nag`. |
| `npm run cdk:diff` | Diffs synthesised infrastructure against the deployed stack. |

## Testing

Tests are written with the code, not after it. A feature whose tests are outstanding is not finished.

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest | `packages/core`: the engine, condition evaluator and validators. Above 90% coverage, because this is pure logic with no I/O and there is no excuse for gaps. |
| Integration | Vitest with Testcontainers | Repositories against real Postgres and Mongo. The database is never mocked. |
| Contract | Vitest with supertest | API endpoints checked against the OpenAPI schema. |
| AWS | LocalStack | Queue consumers, S3 flows and event publication. |
| End to end | Playwright | Complete journeys: submit, approve, escalate, complete. |
| Accessibility | axe-core via Playwright | Every primary page. CI fails on any violation. |
| Load | k6 | Submission and approval endpoints under concurrency. |
| Security | npm audit, Trivy, Gitleaks | Dependencies, images and secrets. |

Four categories of test are mandatory, because each guards a property that is expensive to lose:

1. **Cross-tenant isolation.** For every endpoint, request another organisation's resource by identifier and assert `404`. Never `403`, because a `403` confirms the resource exists.
2. **Version pinning.** Submit a case, publish a breaking change to the definition, and assert the in-flight case still completes correctly on its original version.
3. **Idempotency.** Deliver every queue message twice and assert a single effect. SQS delivers at least once.
4. **Condition evaluation.** Table-driven tests across every operator, including every null and missing-field case.

Accessibility is a completion criterion rather than a follow-up ticket. WCAG 2.2 AA applies to every screen, every drag interaction has a keyboard equivalent, and status is never conveyed by colour alone.

## Documentation

### Specification, in `docs/`

Read in this order. These define the product and do not change casually.

| Document | Holds |
|---|---|
| [PROBLEM-STATEMENT.md](docs/PROBLEM-STATEMENT.md) | Why OrgFlow exists. Every technical decision should trace back to a problem described here. |
| [GOV-STANDARDS.md](docs/GOV-STANDARDS.md) | The quality bar: WCAG 2.2 AA, security, UK GDPR, operational standards, and the release compliance checklist. |
| [TECH-STACK.md](docs/TECH-STACK.md) | Every technology and the reason it was chosen, plus the core concepts the codebase is built on. |
| [PRD-SUMMARY.md](docs/PRD-SUMMARY.md) | Scope, the phase-by-phase build sequence, and the rules of engagement. |
| [PRD.md](docs/PRD.md) | The full specification: data models, engine semantics, API surface, screens, acceptance criteria. |

### Living logs, in `documentation/`

These hold current state, and they are updated in the same commit as the change they describe.

| Document | Holds |
|---|---|
| [client.md](documentation/client.md) | Append-only log of front-end work: components, patterns, dependencies, accessibility decisions. |
| [server.md](documentation/server.md) | Append-only log of back-end work: endpoints, migrations, AWS resources, event contracts. |
| [decisions.md](documentation/decisions.md) | Architectural decision records. Its job is to stop settled questions being reopened. |

[CLAUDE.md](CLAUDE.md) states the operating instructions for this repository: the non-negotiable rules, the naming and text standards, and the git policy.

## Project status

**Active phase: Phase 0, Foundations.** The specification and the documentation structure are complete. Application code has not started.

Phase 0 is deliberately not parallelisable. It is the contract everything else builds against.

| Item | Status |
|---|---|
| Specification documents | Complete |
| Documentation logs and ADR register | Complete |
| Monorepo scaffold with Turborepo and npm workspaces | Outstanding |
| `packages/types` with the core domain contracts | Outstanding |
| Postgres migrations for identity and tenancy | Outstanding |
| Docker Compose for Postgres, Mongo and LocalStack | Outstanding |
| Express API skeleton with health and readiness endpoints | Outstanding |
| Next.js app shell with shadcn and design tokens | Outstanding |
| OIDC auth with a seeded local development path | Outstanding |
| GitHub Actions pipeline | Outstanding |
| CDK skeleton: Network, Data and Messaging stacks | Outstanding |
| ESLint rule enforcing dependency direction | Outstanding |

Phase 0 is done when `npm run dev` starts the whole stack locally, a seeded user can log in and see an empty dashboard, CI runs lint, tests and build on every push, and `cdk synth` succeeds with no unsuppressed `cdk-nag` findings.

The full sequence of phases, from the Phase 1 vertical slice through to Phase 9 hardening, is set out in [docs/PRD-SUMMARY.md](docs/PRD-SUMMARY.md) §5.

## Contributing

### Branches

Every change goes on a branch named `type/kebab-description`, where the type is one of `feat`, `fix`, `chore`, `docs`, `test` or `refactor`. For example, `feat/workflow-engine` or `fix/overdue-task-sort`.

### Commits

[Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint.

```
feat(core): add condition evaluator for comparison operators
fix(api): scope task queries by organisation
docs(server): log the identity schema migration
```

No commit message, pull request body or code comment contains an em-dash, and none credits an AI assistant in any form.

### Change priority

Not every change carries the same risk, so not every change moves the same way.

**Minor.** Commit, push and merge to `main` directly: interface copy, styling and layout, added tests, documentation log entries, bug fixes contained within one module, and refactors that change no interface.

**High.** Branch, push, then stop and request review before merging: any Postgres migration or Mongo document shape change, anything touching authentication, authorisation or tenant isolation, any change to `packages/types`, any change to the workflow engine core, any CDK or infrastructure change, any dependency added or removed, any change to CI/CD configuration, and any change to an existing API contract.

### Definition of done

A change is complete only when all of the following hold.

- [ ] Implemented as specified in [PRD.md](docs/PRD.md)
- [ ] Unit tests pass, with `packages/core` coverage above 90%
- [ ] Integration tests pass against real Postgres and Mongo
- [ ] A cross-tenant isolation test is written and passing
- [ ] axe-core reports zero violations on any new or changed page
- [ ] The keyboard-only journey has been walked
- [ ] Error, empty and loading states are implemented, not deferred
- [ ] `tsc --noEmit` and ESLint are clean
- [ ] No em-dashes in any changed file
- [ ] The relevant documentation log is appended in the same commit
- [ ] Any architectural decision is recorded in [decisions.md](documentation/decisions.md)

## Licence

Not yet set. The intention is an open licence, in line with the "make new source code open" principle in the GDS Service Standard, with MIT as the expected choice. A `LICENSE` file will be added once that is confirmed. Until then, no licence is granted.
