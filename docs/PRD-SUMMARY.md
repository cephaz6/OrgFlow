# OrgFlow: PRD Summary (Baseline)

> **Read this first.** This is the orientation document. It states what OrgFlow is, what is being built in what order, and how agents should operate. `PRD.md` holds the full specification: data models, API surface, engine semantics, acceptance criteria. Do not begin implementation without reading both.

---

## 1. Product in one paragraph

**OrgFlow** is a multi-tenant internal workflow platform. Any organisation can create a workspace, invite members, and build internal processes (access requests, equipment orders, expense approvals, onboarding, policy exceptions) without writing code. A process owner defines a **form** (fields, validation, conditional visibility) and a **workflow** (approval steps, routing rules, deadlines). The platform runs it: routing each submission to the right approvers, notifying and chasing them, tracking live status, and producing a complete audit trail. Processes can be started from a catalogue of system templates or built from scratch and saved as reusable templates.

---

## 2. Users

| Role | Needs |
|---|---|
| **Requester**, anyone in the organisation | Find the right process, understand the rules before submitting, track status without chasing |
| **Approver**, line managers, finance, IT, security | One prioritised queue, all context on one screen, delegation during absence |
| **Process owner**, HR, IT, finance, ops leads | Define and change processes without engineering, see volume and bottlenecks, evidence decisions |
| **Organisation admin** | Manage members and roles, configure identity, oversee all processes |
| **Platform admin**, the OrgFlow operator | Manage system template catalogue, monitor platform health |

---

## 3. Scope

### In scope

- Multi-tenant organisations, self-serve creation, invite-only membership
- OIDC authentication with per-organisation identity provider configuration
- Role-based access control, scoped per organisation
- Drag-and-drop form builder with conditional field visibility
- Visual workflow builder for sequential and conditional approval steps
- Template system: system catalogue, organisation templates, cloning
- Definition versioning with in-flight case pinning
- Form runtime rendering any definition
- Case lifecycle: draft, submitted, in progress, completed, rejected, cancelled
- Task assignment with six resolution strategies
- Approve, reject, send-back-for-changes, comment, reassign, delegate
- File attachments via presigned S3 with asynchronous virus scanning
- Email and in-app notifications
- SLA deadlines with automatic escalation
- Complete append-only audit trail with export
- Reporting: volume, turnaround, bottleneck analysis, rejection reasons
- Full WCAG 2.2 AA compliance
- Data retention, subject access export, redaction

### Out of scope

- Citizen or customer-facing services (internal staff tooling only)
- BPMN 2.0 semantics
- Parallel and multi-branch workflow steps *(v2. The data model accommodates it; the engine does not implement it initially.)*
- System-to-system integration workflows
- Document management, project tracking, CRM
- Mobile native applications (responsive web only)
- Payment processing
- Real-time collaborative editing of definitions

---

## 4. Core concepts

Four ideas govern the entire design. Full detail in `TECH-STACK.md` §11 and `PRD.md`.

1. **Template → Definition → Case.** A template is a non-runnable blueprint. Cloning it produces a definition, which is runnable and versioned. A case is one running instance of one specific version. Cloning is a hard copy, so later template edits never reach existing definitions.

2. **Version pinning.** A case executes the definition version it was submitted against, forever. Publishing a new version never affects in-flight cases. Without this the audit trail is worthless.

3. **The engine is pure.** Given current state, a pinned version, and an event, it returns the next state, tasks to create, and events to emit. No database, no HTTP, no AWS. The caller persists. This makes the hardest logic testable without infrastructure.

4. **Tenant isolation lives in the data layer.** The repository layer cannot construct an unscoped query. Row-Level Security backs it up. Any path where a developer could forget a filter is a defect in the abstraction, not in the developer.

---

## 5. Build sequence

Phases are **sequencing guidance for coherent build order**, not a scope gate. All phases are in scope. Each phase must end with something that works end to end and is deployed. No phase leaves the system in a half-wired state.

### Phase 0: Foundations *(must be complete before anything else)*

Monorepo, shared types, database schemas, CI pipeline, local dev environment, CDK skeleton, auth shell. This phase is the contract everything else builds against. **Do not parallelise this phase.**

**Done when:** `npm run dev` starts the whole stack locally; a seeded user can log in; CI runs lint, tests and build on every push; `cdk synth` succeeds.

### Phase 1: Vertical slice

One hardcoded process (Laptop Request), two-step approval, no builder. Submit → manager approves → IT completes. Postgres cases, tasks, transitions, audit. One SNS event, one SQS queue, one Lambda sending an email. Deployed to AWS via CDK.

**Done when:** a real case can be submitted and approved in a deployed environment, with an audit trail, and the approver receives an email.

**Why first:** proves the entire architecture end to end while the surface area is still small enough to debug.

### Phase 2: Workflow engine

Replace the hardcoded flow with the real engine. Condition evaluator, step types, assignment resolution, transitions. Definitions stored in Mongo and read by the engine. Still no builder UI; definitions are seeded JSON.

**Done when:** a new process can be added by writing JSON, with no code change. Engine unit test coverage above 90%.

### Phase 3: Form runtime and builder

Dynamic form rendering from a definition. Then the drag-and-drop builder with conditional visibility and live preview. Full keyboard alternative to dragging.

**Done when:** a non-technical user can build a form in the UI, save it, and submit against it. `axe-core` passes on builder and runtime.

### Phase 4: Workflow builder

Visual step editor on React Flow. Conditional branching, assignment configuration, SLA settings. Validation preventing unreachable steps and orphaned branches.

**Done when:** a complete process, both form and workflow, can be built entirely in the UI and run.

### Phase 5: Versioning and templates

Publish/draft lifecycle, immutable versions, case pinning enforced and tested. System template catalogue with at least six processes. Organisation templates. Clone-as-hard-copy.

**Done when:** the version-pinning test passes: submit a case, publish a breaking change, confirm the in-flight case still runs correctly.

### Phase 6: Notifications, SLA and escalation

Full notification service with templates and preferences. EventBridge Scheduler timers. Escalation chains. Delegation and out-of-office.

**Done when:** an overdue task escalates automatically and the escalation is audited.

### Phase 7: Files and attachments

Presigned upload, async virus scan, quarantine-until-clean, presigned download, retention.

**Done when:** an infected test file is quarantined and never downloadable.

### Phase 8: Reporting and analytics

Process metrics, bottleneck analysis, approver load, CSV/PDF export via the queue. Aggregate-by-default with permission-gated individual views.

**Done when:** a process owner can see median turnaround and identify the slowest step.

### Phase 9: Administration and hardening

Member management, role assignment, IdP configuration, retention policies, subject access export, redaction. Full accessibility audit. Load testing. Security review against the `GOV-STANDARDS.md` checklist.

**Done when:** every box in the `GOV-STANDARDS.md` §11 compliance checklist is ticked.

---

## 6. Agent operating instructions

### 6.1 Default mode: single sequential agent

For this project the default is **one builder agent working sequentially**. Parallelism on greenfield code costs more in reconciliation than it saves, because there is no established codebase to anchor conflicting interface decisions.

### 6.2 Before writing any code, every session

1. Read `PROBLEM-STATEMENT.md`, `GOV-STANDARDS.md`, `TECH-STACK.md`, `PRD.md`, and this file.
2. Read `documentation/client.md`, `documentation/server.md` and `documentation/decisions.md`. These hold the current state and everything already decided.
3. Confirm which phase is active and what is outstanding.
4. State the plan before implementing.

### 6.3 Rules of engagement

- **Do not invent scope.** If it is not in `PRD.md`, ask before building it.
- **Do not substitute technologies.** The stack in `TECH-STACK.md` is chosen deliberately. Introducing a different library is an ADR decision, recorded and agreed first.
- **Do not break the dependency direction.** `packages/core` has no I/O dependencies. `apps/web` never imports server code. Violating this is a defect regardless of whether it works.
- **Do not skip tenant scoping.** Every query, every message, every S3 key. There are no exceptions, including for admin or reporting paths.
- **Do not weaken accessibility to ship faster.** WCAG 2.2 AA is a completion criterion, not a follow-up ticket.
- **Write tests with the code, not after.** A phase is not done if its tests are outstanding.
- **Prefer vertical slices.** A thin feature working end to end beats a complete layer that cannot be exercised.
- **When the spec is ambiguous, ask.** Do not guess and proceed on a decision that will be expensive to reverse, such as schema shape, API contract or auth model.

### 6.4 Mandatory documentation logging

`documentation/client.md` and `documentation/server.md` are **append-only running logs**, not static documents. They are updated as part of the change, in the same commit, never retrospectively.

**Append an entry whenever any of the following happens:**
- A feature or component is added or significantly changed
- A dependency is added or removed
- A database schema or Mongo document shape changes
- An API endpoint is added, changed or removed
- An AWS resource is introduced
- A pattern or convention is established
- A bug with a non-obvious cause is fixed

**Entry format:**

```markdown
## 2026-08-14: Approval queue view

**Type:** Feature
**Area:** apps/web, app/(app)/approvals

**What changed**
Added the approver queue with age-based sorting and overdue highlighting.

**Why**
Phase 1 requirement. Approvers currently have no way to see outstanding tasks.

**Notes**
- Uses TanStack Query with a 30s refetch interval
- Overdue state indicated by icon plus text, not colour alone (WCAG 1.4.1)
- Empty state added; tested with axe, no violations

**Follow-ups**
- Filtering by process is deferred to Phase 8
```

`documentation/decisions.md` holds architectural decisions in ADR form: context, decision, consequences, alternatives rejected. Its job is to stop settled choices being re-litigated in a later session.

### 6.5 Git and change-priority policy

> **The operator has supplied the concrete permissions. `CLAUDE.md` section 8 is the authoritative statement of them; the classification below is the shape they follow.**

**Minor: commit, push, merge to main directly**
- UI copy, styling and layout adjustments
- Adding tests
- Documentation log entries
- Bug fixes contained within a single module
- Refactors with no interface change

**High: branch, push, stop, request review before merging**
- Any Postgres migration or Mongo document shape change
- Anything touching authentication, authorisation or tenant isolation
- Any change to `packages/types` (it is the contract; changes ripple)
- Any change to the workflow engine core
- Any CDK or infrastructure change
- Adding or removing a dependency
- Any change to CI/CD configuration
- Anything altering an existing API contract

**Branch naming:** `feat/`, `fix/`, `chore/`, `docs/`, `test/`, `refactor/` + kebab-case description.

**Commits:** Conventional Commits, enforced by commitlint.

### 6.6 If scaling to parallel agents later

Only after Phase 0 and Phase 1 are complete and stable. Preconditions:

- `packages/types` frozen for the duration of the parallel work
- API contract fixed in OpenAPI
- Database schema fixed
- Each agent owns a **vertical slice with mocked boundaries**, never "one does frontend, one does backend"
- Each agent works in its own git worktree on its own branch
- Maximum three concurrent agents; beyond that human review becomes the bottleneck
- Every agent appends to the same documentation logs, so conflicts surface in review

**Viable parallel split after Phase 2:**

| Agent | Owns |
|---|---|
| A | Form builder and form runtime (`apps/web`, `packages/ui`) |
| B | Notifications, SLA and escalation (`workers/`, messaging infra) |
| C | Reporting and analytics (API read-side, dashboard UI) |

Each consumes `packages/types` and the OpenAPI contract. None modifies the engine.

---

## 7. Definition of done

A feature is complete only when **all** of the following hold:

- [ ] Implemented per `PRD.md`
- [ ] Unit tests pass; `packages/core` coverage above 90%
- [ ] Integration tests pass against real Postgres and Mongo
- [ ] Cross-tenant isolation test written and passing
- [ ] `axe-core` passes on any new or changed page
- [ ] Keyboard-only journey verified
- [ ] Error states, empty states and loading states implemented
- [ ] `tsc --noEmit` and ESLint clean
- [ ] Appended to `documentation/client.md` or `server.md`
- [ ] Any architectural decision recorded in `documentation/decisions.md`
- [ ] Conventional commit; branch and review policy followed

---

## 8. Success criteria for the project

**Functional**
- A non-technical user can build and publish a working process in under fifteen minutes
- A submitted case routes correctly, notifies the right people, escalates when overdue, and completes
- A published change to a definition provably does not affect in-flight cases
- Cross-tenant access is impossible, demonstrated by an adversarial test suite

**Quality**
- WCAG 2.2 AA verified by automated and manual testing
- Zero high or critical security findings
- API p95 latency under 300ms for read endpoints
- Every queue consumer proven idempotent

**Learning** *(the reason this project exists)*
- TypeScript, React, Next.js and Express exercised at depth
- Lambda, S3, SQS, SNS, API Gateway and EventBridge each used for a genuine purpose, not decoratively
- PostgreSQL and MongoDB each used where they are actually the right tool
- Full test pyramid running in CI/CD, including LocalStack and Testcontainers
- Infrastructure defined entirely as code in CDK
- Multi-tenant isolation designed deliberately and tested adversarially
