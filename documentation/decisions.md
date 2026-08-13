# Architectural decisions

A register of architectural decision records (ADRs) for OrgFlow.

**Read this before proposing an approach.** Its purpose is narrow and important: to stop settled questions being reopened in a later session. If a decision is recorded here, it is closed. Reversing it requires a new ADR that supersedes the old one, not a quiet change in a pull request.

## When to write an ADR

Write one whenever a choice would be expensive to reverse:

- A technology introduced, replaced or rejected
- A schema or data model shape that other code will depend on
- An API contract or versioning strategy
- An authentication or authorisation model
- A tenancy or isolation mechanism
- A messaging topology or event contract
- A deployment or environment topology
- A deliberate deviation from `PRD.md`, `TECH-STACK.md` or `GOV-STANDARDS.md`

Do not write one for a choice that costs nothing to change later. A file layout preference is not an ADR.

## Rules

- **Numbered sequentially**, `ADR-0001` upward. Numbers are never reused.
- **Never delete an ADR.** Superseded records stay, with their status changed and a pointer to the record that replaced them.
- **Status** is one of `Proposed`, `Accepted`, `Superseded by ADR-nnnn`, or `Rejected`.
- **Alternatives rejected is mandatory.** An ADR that lists no alternatives has not recorded a decision, only an outcome, and it will not stop the question being reopened.
- **No em-dashes**, per `CLAUDE.md` §5.1.

## Record format

```markdown
## ADR-0001: Short decision title

**Date:** YYYY-MM-DD
**Status:** Accepted
**Deciders:** Who agreed it

**Context**
The forces at play: the requirement, the constraint, the problem that made a decision necessary.

**Decision**
What was decided, stated plainly and actively.

**Consequences**
What this makes easy, what it makes hard, and what it commits the project to.

**Alternatives rejected**

- **Option A.** Why it was not chosen.
- **Option B.** Why it was not chosen.
```

---

## Records

## ADR-0001: Configuration and secret handling

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** Project operator

**Context**
The initial README listed all fourteen environment variables with concrete example values, including a Postgres connection string carrying credentials. Even though the values were for throwaway local containers, the pattern teaches the wrong habit in the most-read file in the repository, and it duplicates information that `.env.example` already exists to hold. A deliberate convention was needed before any application code starts reading `process.env`.

**Decision**
Every configuration variable is prefixed `ORGFLOW_`. `.env.example` is the single committed source of truth for which variables exist and what each is for; no other document repeats that inventory. Each application validates its entire environment once at startup against a Zod schema and exports a typed, frozen configuration object. `process.env` is read nowhere else in the codebase, and this is enforced by an ESLint rule, not by convention. In a deployed environment, `.env` is not used at all; configuration and secrets come from AWS Secrets Manager and Parameter Store, injected at runtime. `.env.example` may carry the credentials of local Docker Compose containers, because those containers are ephemeral and bound to localhost, so the values are not secrets, but no field that is a genuine secret ever carries a real value there.

**Consequences**
A missing or malformed variable fails loudly at boot with the offending name, rather than surfacing as an undefined value several layers deep at request time. Adding a variable means updating exactly one file plus its schema, not the README. The trade-off is one extra module per application that every new environment-reading feature must route through, which is the point: it makes an accidental `process.env` read outside that module a lint failure rather than a silent leak.

**Alternatives rejected**

- **Document the inventory in the README, as originally written.** Rejected because a second copy of a list of variables is a copy that goes stale, and it is the wrong place to normalise reading secrets casually.
- **Read `process.env` directly wherever a value is needed.** Rejected because it scatters the contract for what configuration exists across the codebase, makes a missing variable a runtime surprise instead of a boot-time failure, and gives no single point to enforce validation or redaction.
- **A `.env.production` committed with placeholder values for every environment.** Rejected because it invites exactly the mistake it is meant to prevent: someone eventually fills in a placeholder with a real value and commits it.

---

## ADR-0002: Staff authentication via Google, through generic OIDC

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** Project operator

**Context**
`GOV-STANDARDS.md` §2 specifies staff identity through Entra ID, Okta or Google Workspace via OIDC, and explicitly rules out GOV.UK One Login, which is the citizen identity system. A first identity provider had to be chosen for Phase 0 and Phase 1 so the auth shell and the seeded development login have something concrete to sit alongside.

**Decision**
Google is the first identity provider, integrated through the generic OIDC Authorization Code flow with PKCE, using `openid-client` rather than a Google-specific SDK. This keeps the integration point identical to what Entra ID or Okta will use later, so adding a second provider is a configuration entry, `identity_providers` rows plus `ORGFLOW_OIDC_*` values, and not a code change. The ID token is validated in full: signature, `iss`, `aud`, `exp`, `nonce`, and `email_verified` is required. Because a bare email is forgeable and Google accounts are not inherently organisation-scoped, the `hd` hosted-domain claim is checked against the organisation's configured `email_domains` before a session is created for a workspace account. Local development does not depend on Google at all; it uses the dummy provider implementation behind the seeded development login, which fails closed outside `local`, per `GOV-STANDARDS.md` §6.2.

**Consequences**
Phase 0 and Phase 1 can build and test the full auth flow, including token validation and domain-based routing, without provisioning a second identity provider. The `hd` claim check means a personal Google account, one not tied to a Workspace domain, cannot authenticate against an organisation that requires domain verification, which is correct for staff tooling but must be documented clearly at the login screen so it is not mistaken for a bug.

**Alternatives rejected**

- **Email magic links.** Rejected: not OIDC, so it does not fit the auth model `GOV-STANDARDS.md` assumes, it depends on SES deliverability for every login rather than only for notifications, and it provides weaker assurance than a corporate identity provider that already enforces the organisation's own authentication policy, such as its own multi-factor requirement.
- **A Google-specific SDK (`google-auth-library`) instead of generic OIDC.** Rejected: it would tie the authentication code to one provider's client shape, so adding Entra ID or Okta later would mean two parallel auth implementations rather than one flow reading different configuration.
- **GOV.UK One Login.** Rejected outright: it is the citizen identity system, `GOV-STANDARDS.md` §2 states this explicitly, and OrgFlow authenticates staff.

---

## ADR-0003: UUID v7 primary keys generated in the application layer

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** Project operator

**Context**
`PRD.md` §2 specifies UUID v7 for every primary key, chosen because it is time-sortable and preserves index locality without exposing a sequential count. Postgres 16, the version `TECH-STACK.md` §5.1 pins for RDS, has no native `uuidv7()` function; that lands in Postgres 18. The `pg_uuidv7` extension implements it, but is not on the RDS-supported extension list, so it is not available in the target deployment.

**Decision**
Primary keys are generated in TypeScript, inside `packages/db`, using a UUID v7 library, and passed into each insert explicitly rather than relying on a column default. This logic sits in `packages/db`, never in `packages/core`, which performs no I/O and must stay pure regardless of how trivial the generation logic is.

**Consequences**
Every insert must supply its own primary key rather than omitting the column and reading back a generated value, which is a small but universal change to how repository write methods are shaped. The moment Postgres 18 is adopted, or `pg_uuidv7` becomes available on RDS, this can move to a column default without changing the type or the value format, since the generated identifiers are wire-compatible either way.

**Alternatives rejected**

- **UUID v4 via `gen_random_uuid()`.** Rejected: it is natively available but not time-sortable, which was the specific property `PRD.md` chose UUID v7 for, and switching to v4 would be a silent regression against the specification rather than a considered substitution.
- **`pg_uuidv7` extension.** Rejected: not supported on RDS, so it would work locally and fail in every deployed environment, which is the worst kind of inconsistency to discover late.
- **Sequential bigint primary keys.** Rejected outright: exposes row counts across tenant boundaries, which `PRD.md` and `GOV-STANDARDS.md` §6.1 both treat as unacceptable for a multi-tenant product.

---

## ADR-0004: Tenant context set per transaction, not per connection

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** Project operator

**Context**
`PRD.md` §2.6, as originally written, set `orgflow.organisation_id` "per connection". Under any connection pool, a value set on a connection persists after the request that set it finishes and is handed, unchanged, to whichever request the pool next assigns that connection to. That leaks one tenant's context into another tenant's query, which is precisely the failure `GOV-STANDARDS.md` §6.1 identifies as an existential risk for a multi-tenant product. The RLS policy as originally written also called `current_setting` without its `missing_ok` argument, which raises an error rather than returning null when the setting is absent, so any connection that had not yet had a tenant set, including the migration runner and the readiness check, would fail on every query.

**Decision**
The tenant is set with `SET LOCAL orgflow.organisation_id = ...`, inside the same transaction as the queries it scopes, never on the bare connection. `SET LOCAL` is transaction-scoped by definition and reverts automatically on commit or rollback, so a connection returned to the pool cannot carry tenant context forward. Every repository call therefore runs inside an explicit transaction, even a single `SELECT`. RLS policies read the setting with `current_setting('orgflow.organisation_id', true)`, so an unset value resolves to null and the comparison fails closed, denying the row rather than raising.

**Consequences**
Every repository method wraps its work in a transaction, which is a small overhead accepted deliberately, since the alternative is a class of bug that leaks data across tenants. This is the one place in the schema where `PRD.md` as originally specified would have produced the exact failure the whole isolation design exists to prevent, so `packages/db`'s connection-handling code is a high-priority path for the cross-tenant test suite required by `GOV-STANDARDS.md` §6.1 and `TECH-STACK.md` §8.

**Alternatives rejected**

- **Set per connection, as originally specified, and rely on the pool always resetting session state between checkouts.** Rejected: this depends on pool configuration and discipline holding for the life of the project with zero exceptions, where `SET LOCAL` makes the correct behaviour structural rather than a matter of remembering to reset it.
- **Application-level tenant filtering only, without RLS.** Rejected: `PRD.md` and `GOV-STANDARDS.md` §6.1 both require RLS as defence in depth alongside the repository layer, not as a substitute for it.
- **`current_setting` without `missing_ok`, catching the exception in application code.** Rejected: it turns a configuration gap into a thrown error on the hot path of every query, rather than the policy failing closed on its own.

---

## ADR-0005: MIT licence

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** Project operator

**Context**
`GOV-STANDARDS.md` §4 records "make new source code open" as a Technology Code of Practice point OrgFlow commits to, and the README could not state a licence until one was chosen. A licence change after external contributions exist requires the consent of every contributor, so it is worth setting deliberately now rather than defaulting into one later.

**Decision**
MIT. A `LICENSE` file sits at the repository root, and the README states it plainly rather than leaving it unset.

**Consequences**
The repository can be forked, reused and redistributed with minimal friction, which fits a learning project intended to be publicly readable. It carries no patent grant and no copyleft obligation, so nothing downstream is required to remain open.

**Alternatives rejected**

- **Apache 2.0.** Rejected: its explicit patent grant is more relevant to a project fielding patentable techniques than a workflow platform assembled from well-understood web technologies, so the extra licence text bought little here.
- **No licence, left as an all-rights-reserved private repository.** Rejected: conflicts directly with the open-source commitment `GOV-STANDARDS.md` records.
- **A copyleft licence such as AGPL.** Rejected: this is a learning project, not a product OrgFlow needs to defend from unmodified commercial reuse, so copyleft's obligations were unwarranted friction.

---

## ADR-0006: pnpm workspaces instead of npm workspaces

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** Project operator

**Context**
`TECH-STACK.md` §1 originally pinned npm workspaces alongside Turborepo as the monorepo tool. Before any code or CI configuration came to depend on that choice, the operator questioned it while reviewing the Phase 0 scaffolding plan. npm hoists all dependencies into a single flat `node_modules`, which means a package can import something it never declared in its own `package.json` and the import will still resolve, because some other package's dependency happens to be hoisted alongside it. That failure mode is invisible locally and surfaces only when the dependency graph shifts, which is exactly the kind of defect `CLAUDE.md` §3 wants structurally impossible rather than caught by review, in the same spirit as the dependency-direction ESLint rule.

**Decision**
The monorepo uses **pnpm workspaces** (`pnpm-workspace.yaml`) in place of npm workspaces. Turborepo remains the task orchestrator, unchanged. Every `npm <command>` reference in the documentation becomes `pnpm <command>`, including the `npm run dev` used as shorthand for "one command starts everything" in `TECH-STACK.md` §7 and the Phase 0 acceptance criteria in `PRD.md` §20 and `PRD-SUMMARY.md` §5, since those commands would not actually work once package dependencies inside the workspace use `workspace:*` specifiers, which pnpm resolves and npm does not.

**Consequences**
`pnpm-lock.yaml` is the committed lockfile, not `package-lock.json`. CI installs via `pnpm/action-setup` rather than npm's built-in caching. Every workspace package gets pnpm's strict, symlinked `node_modules`, so an undeclared import fails immediately at install or build time instead of working by accident. This is the one place in the toolchain where a "file layout preference" style decision was deliberately promoted to an ADR, because it changes the lockfile format and the CI install step for the life of the project, which is exactly the kind of thing this register exists to stop being silently re-decided later.

**Alternatives rejected**

- **npm workspaces, as originally specified in `TECH-STACK.md` §1.** Rejected: the phantom-dependency gap described above, plus slower, larger installs in CI than pnpm's content-addressable store produces.
- **Yarn Berry (Plug'n'Play).** Rejected: PnP's resolution model is a bigger departure from the conventional `node_modules` shape that most tooling and troubleshooting guidance assumes, which is unwarranted friction for a learning project versus pnpm's more conventional (if strict) layout.
