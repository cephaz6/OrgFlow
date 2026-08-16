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

| Area             | Technology                                   |
| ---------------- | -------------------------------------------- |
| Language         | TypeScript, everywhere                       |
| Repository       | pnpm workspaces with Turborepo               |
| Web              | Next.js 15 (App Router), React 19            |
| UI               | shadcn/ui on Radix, Tailwind CSS 4           |
| API              | Express 5                                    |
| Runtime data     | PostgreSQL 16 via Kysely                     |
| Definition store | MongoDB                                      |
| Auth             | OIDC (Authorization Code flow with PKCE)     |
| Async            | SQS, SNS, EventBridge Scheduler, Lambda      |
| Email            | SES, behind a swappable sender interface     |
| Infrastructure   | AWS CDK                                      |
| Testing          | Vitest, Testcontainers, Playwright, axe-core |
| CI/CD            | GitHub Actions                               |

The reasoning behind each choice is in [docs/TECH-STACK.md](docs/TECH-STACK.md);
substituting one is an architectural decision, recorded in
[documentation/decisions.md](documentation/decisions.md) and agreed first.

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
reading of the clock. This is what makes the hardest logic in the product
testable in milliseconds without infrastructure. `apps/web` imports only
`types` and `ui`, never server code.

## Getting started

Requires Node.js 22, npm 10+, and Docker (for Postgres, MongoDB and LocalStack).

```bash
git clone https://github.com/cephaz6/OrgFlow.git
cd OrgFlow
npm install
cp .env.example .env   # see the file for what each variable is for
npm run dev
```

One command starts the whole local stack: containers, migrations, the seed
script, the API and the web application, at `http://localhost:3000`.

## Documentation

| Document                                               | Holds                                                     |
| ------------------------------------------------------ | --------------------------------------------------------- |
| [docs/PROBLEM-STATEMENT.md](docs/PROBLEM-STATEMENT.md) | Why OrgFlow exists                                        |
| [docs/GOV-STANDARDS.md](docs/GOV-STANDARDS.md)         | The quality bar: accessibility, security, data protection |
| [docs/TECH-STACK.md](docs/TECH-STACK.md)               | Every technology and the reason it was chosen             |
| [docs/PRD-SUMMARY.md](docs/PRD-SUMMARY.md)             | Scope, build phases, rules of engagement                  |

## Licence

[MIT](LICENSE).
