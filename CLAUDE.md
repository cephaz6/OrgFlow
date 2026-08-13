# CLAUDE.md: OrgFlow Operating Instructions

> Read this at the start of every session, before writing any code.

---

## 1. What this project is

**OrgFlow** is a multi-tenant internal workflow platform. Organisations create workspaces, invite members, and build internal processes (access requests, equipment orders, expense approvals, onboarding) without writing code. A process owner defines a **form** and a **workflow**; the platform runs it, handling routing, notifying, chasing, tracking and auditing.

**This is a learning project.** The goal is depth in TypeScript, React, Next.js, Express, AWS (Lambda, S3, SQS, SNS, API Gateway, EventBridge), PostgreSQL, MongoDB, automated testing in CI/CD, and infrastructure as code. Take the path that teaches, not the path that shortcuts, but never at the cost of correctness.

---

## 2. Required reading order

1. `docs/PROBLEM-STATEMENT.md`: why this exists
2. `docs/GOV-STANDARDS.md`: the quality bar, especially accessibility and security
3. `docs/TECH-STACK.md`: what to build with and why
4. `docs/PRD-SUMMARY.md`: scope, phases, rules of engagement
5. `docs/PRD.md`: the full specification
6. `documentation/decisions.md`: what has already been decided
7. `documentation/client.md` and `documentation/server.md`: what has already been built

Steps 6 and 7 are not optional. They hold current state. Skipping them means re-deciding settled questions and rebuilding existing work.

---

## 3. Non-negotiable rules

**Tenant isolation**
- Every Postgres query is scoped by `organisation_id`. Every Mongo query by `organisationId`. No exceptions, including admin, reporting and background jobs.
- Scoping lives in the repository layer. If a route handler *could* forget it, the abstraction is wrong.
- Tenant context comes from the authenticated session. Never from a body, query param or header.
- Cross-tenant access returns `404`, never `403`.

**Version pinning**
- A case executes the definition version it was submitted against, forever.
- Load definitions by `version_id`. Loading by `definition_id` in a case execution path is a defect.

**Engine purity**
- `packages/core` performs no I/O. No database, no HTTP, no AWS SDK, no `Date.now()`. Time is injected via context.
- The engine returns what should happen. The caller persists it.

**Dependency direction**
- `types` → `core` → `db`/`documents`/`events` → `api`/`workers`
- `web` imports only `types` and `ui`. It never imports server code.
- Enforced by ESLint. Violating it is a defect even if it compiles.

**Accessibility**
- WCAG 2.2 AA is a completion criterion, not a follow-up ticket.
- Every drag interaction has a keyboard equivalent.
- `axe-core` passes in CI. Zero violations.
- Status is never conveyed by colour alone.

**Security**
- Never `eval` a tenant-authored expression. The condition language is a declarative AST interpreted by a pure function.
- Parameterised queries only.
- No secrets in the repository.
- Audit rows are append-only, enforced by database grants.

**Testing**
- Tests are written with the code, not after.
- Never mock the database in integration tests; use Testcontainers.
- Every queue consumer has an idempotency test that delivers the same message twice.

---

## 4. Conventions

| Context | Convention |
|---|---|
| TypeScript variables, functions, properties | `camelCase` |
| TypeScript types, interfaces, classes | `PascalCase` |
| TypeScript constants | `SCREAMING_SNAKE_CASE` |
| Postgres tables and columns | `snake_case`, tables plural |
| MongoDB collections and fields | `camelCase` |
| API routes | `kebab-case`, plural |
| API JSON keys | `camelCase` |
| Component files | `PascalCase.tsx` |
| All other files | `kebab-case.ts` |
| Directories | `kebab-case` |
| Environment variables | `ORGFLOW_` prefix, `SCREAMING_SNAKE_CASE` |
| Events | `dot.case`, past tense, for example `case.submitted` |
| Branches | `type/kebab-description` |

**The single mapping boundary:** `camelCase` in TypeScript ↔ `snake_case` in Postgres, translated inside `packages/db` and nowhere else. Mongo needs no mapping.

---

## 5. Text and styling standards

> These three rules supersede anything that conflicts with them elsewhere in `docs/`.

### 5.1 Formal text standard

- **No em-dashes anywhere.** This covers documentation, README, UI copy, code comments, commit messages, log entries, ADRs and test descriptions. Use a comma, a colon, a semicolon, parentheses, or a separate sentence.
- Hyphens in compound words are correct and expected: `drag-and-drop`, `multi-tenant`, `read-only`.
- En-dashes in numeric ranges are acceptable: `09:00–17:00`, `2024–2026`.
- Write in a formal register. Do not use contractions.
- British English spelling in prose (`organisation`, `colour`, `authorise`), except where an API, library or identifier requires the American form. This governs prose, not code: the CSS `color` property stays as the language defines it.

### 5.2 Typography

- Interface typefaces come from Google Fonts, loaded through `next/font/google`. Self-hosted and subset at build time, so no runtime request to Google and no layout shift.
- One sans-serif for the interface, optionally one monospace for code, reference numbers and audit identifiers.
- Both are exposed as CSS custom properties (`--font-sans`, `--font-mono`) inside the design token layer, wired into the Tailwind theme. No component names a font family directly.
- Because the fonts are tokens, a GOV.UK theme can replace them with GDS Transport by swapping the token set alone.

### 5.3 Styling

- Tailwind CSS with shadcn/ui components. No other styling system.
- Every colour, spacing, radius, typography and shadow value is expressed as a design token, defined once as a CSS custom property and consumed through the Tailwind theme.
- **No raw hex values in components.** No `#0b5fff`, no `rgb(...)`, no `hsl(...)`.
- **No direct Tailwind palette colours in components.** No `bg-blue-600`, no `text-slate-500`. Use semantic tokens such as `bg-primary`, `text-muted-foreground`, `border-destructive`.
- Raw values are permitted in exactly one place: the token definition file. Everywhere else is a defect, and this is enforced by lint rather than by review.
- Status is never conveyed by colour alone; every status token pairs with an icon or a text label.

---

## 6. Mandatory documentation logging

`documentation/client.md` and `documentation/server.md` are **append-only running logs**. Update them **in the same commit as the change**, never retrospectively.

**Append an entry when:**
- A feature or component is added or significantly changed
- A dependency is added or removed
- A Postgres schema or Mongo document shape changes
- An API endpoint is added, changed or removed
- An AWS resource is introduced
- A pattern or convention is established
- A bug with a non-obvious cause is fixed

**Format:**

```markdown
## YYYY-MM-DD: Short title

**Type:** Feature | Change | Fix | Dependency | Schema | Infrastructure
**Area:** package/path

**What changed**
One or two sentences.

**Why**
The requirement or problem it addresses.

**Notes**
- Decisions made, patterns used, gotchas encountered

**Follow-ups**
- Anything deliberately deferred
```

`documentation/decisions.md` holds ADRs, each stating context, decision, consequences and alternatives rejected. Write one whenever a choice would be expensive to reverse. Its purpose is to stop settled questions being reopened in a later session.

---

## 7. Working method

**At the start of a session**
1. Read the documents in §2.
2. State which phase is active and what is outstanding.
3. State the plan before implementing.

**While working**
- Build vertical slices. A thin feature working end to end beats a complete layer that cannot be exercised.
- Implement error, empty and loading states as part of the feature, not afterwards.
- When the spec is ambiguous on something expensive to reverse, such as schema shape, API contract or auth model, **ask rather than guess**.
- Do not invent scope. If it is not in `PRD.md`, ask first.
- Do not substitute technologies. Introducing a library not in `TECH-STACK.md` is an ADR decision, agreed first.

**Definition of done**
- [ ] Implemented per `PRD.md`
- [ ] Unit tests pass; `packages/core` coverage above 90%
- [ ] Integration tests pass against real Postgres and Mongo
- [ ] Cross-tenant isolation test written and passing
- [ ] `axe-core` passes on any new or changed page
- [ ] Keyboard-only journey verified
- [ ] Error, empty and loading states implemented
- [ ] `tsc --noEmit` and ESLint clean
- [ ] No em-dashes in any changed file, per §5.1
- [ ] Documentation log appended
- [ ] Architectural decisions recorded

---

## 8. Git and change-priority policy

**Permissions granted by the operator.** Full read, write, grep and ssh access within the project. Standing authority to stage, commit and push. Every new feature goes on its own branch. Remote: `https://github.com/cephaz6/OrgFlow.git`.

**Attribution.** No commit message, PR body or code comment credits Claude, Anthropic or any AI assistant, in any form. No `Co-Authored-By` trailer, no "generated with" line. Sole authorship in the repository history is the standing assumption.

**Staging.** Stage named files. Never `git add -A` or `git add .`. Review the diff before staging, every time.

**Minor: commit, push and merge to `main` directly**
- UI copy, styling, layout
- Adding tests
- Documentation log entries
- Bug fixes contained within one module
- Refactors with no interface change

**High: branch, push, then stop and request a decision before merging**
- Any Postgres migration or Mongo document shape change
- Anything touching authentication, authorisation or tenant isolation
- Any change to `packages/types`
- Any change to the workflow engine core
- Any CDK or infrastructure change
- Adding or removing a dependency
- Any change to CI/CD configuration
- Any change to an existing API contract

Classify every push before making it. When in doubt, treat it as high and ask.

**Commits:** Conventional Commits, enforced by commitlint. Subject lines carry no em-dash.
**Branches:** `feat/`, `fix/`, `chore/`, `docs/`, `test/`, `refactor/` plus a kebab-case description.

---

## 9. Current phase

> Update this section as phases complete.

**Active phase:** Phase 0, Foundations

**Outstanding:**
- [ ] Monorepo scaffold with Turborepo and npm workspaces
- [ ] `packages/types` with core domain contracts
- [ ] Postgres migrations for identity and tenancy tables
- [ ] Docker Compose for Postgres, Mongo, LocalStack
- [ ] Express API skeleton with health and readiness endpoints
- [ ] Next.js app shell with shadcn and design tokens
- [ ] OIDC auth with seeded local development path
- [ ] GitHub Actions pipeline: lint, typecheck, test, build
- [ ] CDK skeleton: Network, Data, Messaging stacks
- [ ] ESLint rule enforcing dependency direction

**Phase 0 is not parallelisable.** It is the contract everything else builds against.
