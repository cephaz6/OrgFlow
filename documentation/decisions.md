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

---

## ADR-0007: `.env.example` carries no values at all

**Date:** 2026-08-13
**Status:** Accepted, supersedes the values policy in ADR-0001
**Deciders:** Project operator

**Context**
ADR-0001 decided that `.env.example` could carry concrete values where they were local, throwaway and not secret: ports, localhost URLs, the credentials of ephemeral Docker Compose containers. In practice this meant a committed file mixed pure documentation (variable names, what each is for) with working configuration (actual connection strings), which is exactly the kind of file a future contributor skims and copies without reading closely. With AWS Secrets Manager integration planned for a later phase, the operator chose to tighten the convention now, before the habit of putting any value, however harmless, into a committed file becomes established.

**Decision**
`.env.example` lists every variable name and its explanatory comment, with every value left blank. It is documentation only: which variables exist and what each does, never what to set them to. The actual local development values, including the harmless Docker Compose credentials ADR-0001 permitted, now live only in a real `.env` at the repository root, which is gitignored and was never committed.

**Consequences**
A contributor copying `.env.example` to `.env` starts from a genuinely blank slate and must supply every value deliberately, including the harmless ones, rather than inheriting values by default. This is a small amount of extra local setup friction in exchange for a committed file that can never be mistaken for carrying anything usable. `ORGFLOW_` variables gated behind AWS Secrets Manager in a later phase slot into the same blank-by-default pattern without a further convention change.

**Alternatives rejected**

- **Keep ADR-0001's mixed convention.** Rejected: the operator judged the small convenience of pre-filled local values not worth the risk of the pattern normalising committed values as the project's dependency on real secrets grows.
- **Delete `.env.example` and document variables in `TECH-STACK.md` or a README table instead.** Rejected: ADR-0001 already rejected a second, driftable copy of the variable inventory living in prose documentation; that reasoning still holds.

---

## ADR-0008: `apps/web` organised as a modular monolith

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** Project operator

**Context**
The operator wants each frontend concern, notifications and authentication named specifically, built as an individually swappable unit, so a concern such as the identity provider integration or the notification delivery channel can be replaced later without a rewrite rippling through the rest of the app. `TECH-STACK.md` fixes the outer shape (one Next.js app, one Express API, no micro-frontends) but says nothing about how `apps/web` is organised internally, which left it open to drift into an undifferentiated `components/`, `hooks/`, `pages/` layout where every feature reaches into every other feature's internals. A decision was needed before any frontend code exists, since retrofitting module boundaries onto an already-tangled app is far more expensive than establishing them from the first feature.

**Decision**
`apps/web` is organised as a set of vertical-slice feature modules under `apps/web/src/features/<feature>/` (`auth`, `notifications`, `cases`, `catalogue`, and so on), each exposing its public surface through a single `index.ts` barrel. Nothing outside a feature imports that feature's internals directly. Any feature that wraps a genuinely swappable external integration, the identity provider or the notification delivery channel among them, defines an interface for that integration plus a dummy implementation, following the pattern the `3pservice` skill already establishes for third-party integrations elsewhere in the project, so the concrete choice can change behind that interface without touching call sites. Cross-feature communication happens through typed events or a shared, feature-agnostic store, never a direct import of one feature's internals from another, mirroring the `events` skill's guidance for backend modules that may later become standalone services. True micro-frontends, with independent builds and runtime composition, were explicitly considered and rejected; this stays one Next.js build.

**Consequences**
Adding a feature means adding a folder with its own barrel export, not scattering files across shared `components/`, `hooks/` and `pages/` directories by technical layer. Swapping an integration means writing a new implementation of an existing interface, not touching the feature's consumers. The dependency-direction ESLint rule due in the Phase 0 build order (step 3) gains a second layer once this is enforced: not only `types → core → db/documents/events → api/workers` and `web → types/ui`, but feature boundaries within `apps/web` itself. That specific rule is deferred until two or three real features exist and the boundary is real rather than speculative, consistent with `CLAUDE.md`'s instruction against designing for requirements not yet stated.

**Alternatives rejected**

- **True micro-frontends (Module Federation or similar).** Rejected: real added complexity, new build tooling and runtime composition risk, for a project at this scale, and it contradicts the single Next.js app decision already in `TECH-STACK.md` §1.
- **A conventional layer-first structure (`components/`, `hooks/`, `pages/` shared across all features).** Rejected: this is exactly what produces the tangled cross-feature coupling the operator wants to avoid. A feature cannot be understood, tested or swapped in isolation when its pieces are scattered across shared directories by technical layer instead of grouped by domain.

---

## ADR-0009: `orgflow_app` assumed via `SET LOCAL ROLE`, not connected to directly

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** Project operator

**Context**
`PRD.md` §2.5 creates `orgflow_app` as `NOLOGIN` and comments that "the application connects as orgflow_app," which is contradictory as literally written: a `NOLOGIN` role cannot authenticate a database connection. The surrounding comment is clear on the property that matters, that the application must never operate as the tables' owner, because `FORCE ROW LEVEL SECURITY` still exempts an owning role, so a decision was needed on the actual connection mechanics before `packages/db` could implement the `SET LOCAL` transaction pattern from ADR-0004.

**Decision**
The application connects with an ordinary login role, locally the Docker Compose bootstrap `orgflow` user, and every scoped transaction issues `SET LOCAL ROLE orgflow_app` in addition to `SET LOCAL orgflow.organisation_id = ...`, both inside the same transaction the query runs in. Postgres evaluates Row-Level Security and ownership-bypass against the role active after `SET ROLE` (`current_user`), not the role that authenticated the connection (`session_user`), so this correctly subjects every scoped query to tenant isolation even though the connecting role is a superuser locally. The connecting role is granted membership in `orgflow_app` (`GRANT orgflow_app TO orgflow;`) so `SET ROLE` is permitted without relying on superuser privilege to bypass the membership check, keeping the mechanism valid once a deployed environment uses a non-superuser connecting role.

**Consequences**
`packages/db`'s transaction helper sets both `SET LOCAL` values together, so a repository call that forgets one is incomplete rather than partially safe. No second Postgres role is needed locally beyond `orgflow_app` itself. The migration that creates `orgflow_app` must also grant it membership to whichever role runs migrations, and must grant `orgflow_app` itself the ordinary CRUD privileges the application needs on each tenant table, since `PRD.md` only shows the append-only grant for `audit_events` and is silent on the rest.

**Alternatives rejected**

- **A dedicated third login role** (for example `orgflow_app_login`), granted membership in `orgflow_app`, with `ORGFLOW_DATABASE_URL` pointed at it instead of the Docker Compose bootstrap user. Rejected: adds a role, a grant and compose/init wiring to create it locally, without adding any protection beyond `SET LOCAL ROLE`, since Postgres already evaluates RLS against `current_user` after `SET ROLE` regardless of which role authenticated the connection.
- **Treating "connects as orgflow_app" literally and making the role `LOGIN`.** Rejected: this was considered as the simplest fix, but it was not what the surrounding comment protects against. The property PRD.md cares about, that the effective role never owns the tables, holds under `SET ROLE` without changing `orgflow_app`'s login attribute, and changing it would be a needless deviation from the exact SQL the PRD specifies.

---

## ADR-0010: Sessions are a stateless signed cookie, not a server-side store

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** Project operator

**Context**
`PRD.md` §12.1 says to "create session; set httpOnly Secure SameSite=Lax cookie" but does not say what the cookie holds or where session state lives. `PRD.md` §2's Postgres schema has no `sessions` table, and no session store (Redis or otherwise) appears anywhere in `TECH-STACK.md`. `TECH-STACK.md` §4 does list `jose` for apps/api specifically for JWT/JWS handling, and `ORGFLOW_SESSION_SECRET` already exists in the environment convention from Phase 0 step 1. A decision was needed before the auth shell could issue or verify a session at all.

**Decision**
A session is a JWE, signed and encrypted with `ORGFLOW_SESSION_SECRET` using `jose`, carried directly in the httpOnly, Secure, SameSite=Lax cookie: no server-side session table or store. The token's claims carry `userId`, the active `organisationId` once one is selected, `roles`, `issuedAt` and an absolute expiry; both are checked on every verify, per `GOV-STANDARDS.md` §6.2's absolute and idle timeout requirement. "Rotate the session identifier on privilege change" (also §6.2) is implemented by re-issuing a fresh token with new claims and a new `issuedAt`, not by invalidating a stored identifier, since nothing is stored server-side to invalidate.

**Consequences**
No Redis or other session-store infrastructure is needed for Phase 0 or Phase 1. Revoking one specific still-valid session before its natural expiry, for example a "log out everywhere" feature or responding to a compromised session, is not possible under this design, because there is no server-side record to delete; this is a real capability gap, deferred as a follow-up rather than solved now, since `PRD.md` does not currently ask for it. If that requirement becomes concrete, it will need a supersession of this ADR, most likely a short-lived denylist or a move to a server-side store.

**Alternatives rejected**

- **A `sessions` table in Postgres**, keyed by a random identifier stored in the cookie. Rejected: `PRD.md`'s schema does not define one, introducing it was not asked for, and it would need its own cleanup job for expired rows, none of which Phase 0's scope covers.
- **A Redis-backed session store.** Rejected: not part of `TECH-STACK.md`'s dependency list, and would add new local infrastructure (another Docker Compose service) that nothing in the PRD calls for.

---

## ADR-0011: Pre-tenant-context identity lookups bypass RLS deliberately

**Date:** 2026-08-13
**Status:** Accepted
**Deciders:** Project operator (in absence; flagged for review on return)

**Context**
`PRD.md` §12.1 has two lookups that happen before any single organisation has been chosen for the session: step 2, resolving which identity provider governs a given email's domain (`GET /auth/providers?email=`), and step 7, resolving which organisations the now-authenticated user belongs to. Both `identity_providers` and `organisation_members` carry the `tenant_isolation` RLS policy from `PRD.md` §2.6: a row is visible only when its `organisation_id` matches the single value in `orgflow.organisation_id` for the current transaction. At both of these points in the flow there is no such value yet, by definition, since discovering which organisation is in play is the very thing each step needs to do. Under the policy as written, a query with no tenant context set does not error, it silently returns zero rows for every organisation, which would make both PRD-mandated steps permanently impossible through the ordinary tenant-scoped query path (`withTenantTransaction`), not merely awkward.

**Decision**
Two narrowly-scoped repository functions, `findIdentityProviderByEmailDomain(email)` and `findMembershipsForUser(userId)`, query `identity_providers` and `organisation_members` respectively without going through `withTenantTransaction`: neither issues `SET LOCAL ROLE orgflow_app`, and both run as the same elevated connecting role migrations already use (locally, the Docker Compose bootstrap `orgflow` superuser, which bypasses RLS by virtue of the superuser attribute itself, not by weakening any policy). Both are treated as deliberate identity-plane exceptions, not a general escape hatch: each accepts only the one identifying argument its name describes, neither accepts an `organisationId` or any tenant-scoped filter, neither is exported for use outside the auth flow, and together they are the only places in the codebase permitted to read these two tables unscoped. Everything downstream of choosing an organisation, every ordinary business query, still goes through `withTenantTransaction` exactly as ADR-0004 and ADR-0009 require.

**Consequences**
The auth flow can complete `PRD.md` §12.1 steps 2 and 7 at all, which are otherwise structurally impossible under the RLS policy as specified. This narrows, rather than removes, the tenant-isolation guarantee: there are now exactly two code paths that can read across organisations, and both are auditable by name and by the fact that they are the only callers of an elevated, non-`SET ROLE` connection outside the migration runner. In a deployed environment, the elevated connecting role must not be a blanket superuser the way the local bootstrap user is; it needs the narrower `BYPASSRLS` attribute (or equivalent) granted specifically so these two queries keep working without the connecting credential otherwise being able to bypass RLS on every table. That deployment-time role design is deferred to the CDK/RDS work in a later phase and is flagged here so it is not forgotten.

**Alternatives rejected**

- **Do nothing and accept these steps cannot be implemented as specified.** Rejected outright: both are named steps in `PRD.md`'s own auth flow, not an optional nicety.
- **Separate, unscoped mapping tables** (for example `user_organisation_index`, `email_domain_provider_index`) maintained alongside `organisation_members` and `identity_providers`. Rejected: introduces a second source of truth that must stay in sync with every insert, update and removal on the table it mirrors, which is exactly the kind of drift-prone denormalisation the rest of the schema avoids; not asked for by `PRD.md`.
- **Weaken the RLS policies themselves** to also match on `user_id` or `email_domains`, via a join or a broader `USING` clause. Rejected: this was considered, but it would mean the policy engine trusts a different, weaker claim on every single query against these tables, not just at these two narrow, unauthenticated or pre-tenant moments in the login flow.

## ADR-0012: CDK skeleton: no NAT gateway, security groups co-located with the resource they protect, cdk-nag v2

**Date:** 2026-08-14
**Status:** Accepted
**Deciders:** Project operator (in absence; flagged for review on return)

**Context**
`TECH-STACK.md` §7 specifies `NetworkStack`, `DataStack` and `MessagingStack`, with cdk-nag AWS Solutions checks required to pass with zero unsuppressed findings before `cdk synth` counts as done (`PRD.md` §20). Building the three stacks surfaced three decisions with no single obviously-correct default.

**Decision**
Three separate choices, recorded together since one build order step produced all three.

First, the VPC has no NAT gateway. Nothing in this skeleton runs inside a private subnet that needs outbound internet access; RDS lives in an isolated subnet and reaches Secrets Manager through an interface VPC endpoint, S3 through a gateway endpoint. A NAT gateway costs money every hour regardless of traffic, for a capability nothing yet uses.

Second, `DataStack` creates and owns the RDS security group itself, not `NetworkStack`. The first attempt had `NetworkStack` create it and hand it to `DataStack`, which seemed like the more natural split (network primitives in `NetworkStack`, everything else downstream). It produced a real circular dependency the moment `DataStack` called `addRotationSingleUser()` on the database: the generated rotation Lambda needs an ingress rule added to the database's security group referencing the database's own port, and because that security group's CFN resource lived in `NetworkStack`, the new rule made `NetworkStack` depend on `DataStack` while `DataStack` already depended on `NetworkStack` for the security group, a cycle CDK correctly refused to synthesise. The general shape of the problem: a security group whose rules keep being extended by features of the resource it protects belongs in the same stack as that resource, not upstream of it. `NetworkStack` now provides only the VPC and its endpoints; every stack that needs a security group creates its own.

Third, MessagingStack's SNS topic and SQS queues use a KMS key created inside `MessagingStack`, not `DataStack`'s customer-managed key. The first attempt shared `DataStack`'s key across both stacks, on the reasoning that one key is simpler to rotate and audit than two. It produced the same class of cycle as above: granting the SNS topic permission to use the key attaches a statement to the key's own resource policy, which lives in `DataStack`, while `MessagingStack` already depends on `DataStack` for the key. Separately, AWS does not allow an SNS-to-SQS subscription onto a queue encrypted with the AWS-managed `alias/aws/sqs` key at all (SNS cannot be granted publish access to a key it does not own), which rules out the other obvious way to avoid a second customer-managed key. `MessagingStack` now has its own key, encrypting only its own resources.

Fourth, cdk-nag is pinned to the 2.x line (`^2.38.2`), not the newly-released 3.x. Version 3 removed `NagSuppressions.addResourceSuppressions`, the suppression API essentially every existing cdk-nag example and this codebase's suppression comments assume, and replaced it with CDK's own `Validations.of().acknowledge()`, a mechanism with a single visible release behind it at the time of writing. The 2.x line has over a thousand releases and is what `TECH-STACK.md`'s unversioned "cdk-nag" reference was written against.

**Consequences**
The VPC has no path to the public internet from a private subnet; a later phase adding a worker or API compute stack that needs outbound internet access (calling an external API, for example) adds a NAT gateway or additional VPC endpoints then, deliberately, rather than this stack having provisioned one speculatively. The security-group-ownership pattern (co-located with the protected resource) is now the convention for every future stack that creates a security group needing ongoing rule additions; a future stack that instead creates a shared security group upstream and lets a downstream stack hand it rules back is reintroducing the exact cycle this ADR fixes. Three RDS cdk-nag findings are suppressed for non-production environments specifically (multi-AZ, deletion protection, non-default port), each tied to the `environment.isProduction` flag already threaded through every stack; a production `cdk synth` does not trigger the first two suppressions at all, since `DataStack` sets `multiAz` and `deletionProtection` to `environment.isProduction` directly, and the port-obfuscation suppression is judged not to add real defence in depth over an isolated subnet plus security groups, so it applies unconditionally. Upgrading to cdk-nag v3 later is a real migration (every suppression call site changes shape), not a routine dependency bump; it should be its own deliberate piece of work, not a byproduct of an unrelated `pnpm update`.

**Alternatives rejected**

- **NAT gateway from the start**, so a later phase adding outbound-internet-needing compute does not need an infrastructure change. Rejected: pays an ongoing cost now for a capability nothing in Phase 0 uses; adding a NAT gateway later is a small, well-understood CDK change, not a risky one.
- **Shared security group in `NetworkStack`, with ingress rules added by whichever downstream stack needs them.** This was the first implementation. Rejected after it produced a real `cdk synth` circular-dependency error from `addRotationSingleUser()`; documented above as the actual failure encountered, not a hypothetical.
- **Shared KMS key across `DataStack` and `MessagingStack`.** Also the first implementation, also rejected after producing a real circular-dependency error, plus the separate, harder blocker that AWS rejects an SNS-to-SQS subscription onto an AWS-managed-key-encrypted queue outright.
- **cdk-nag v3**, migrating every suppression to `Validations.of().acknowledge()`. Rejected for now: a one-release-old suppression API is a larger, less-documented surface to build a Phase 0 foundation on than the mature v2 line; nothing in `TECH-STACK.md` requires v3 specifically.

## ADR-0013: Case reference numbers are allocated at submit, by an atomic counter increment

**Date:** 2026-08-14
**Status:** Accepted
**Deciders:** Project operator (in absence; flagged for review on return)

**Context**
`PRD.md` §2.2 and §2.3 specify a human-facing case reference such as `LAP-000123`, built from `process_definitions.reference_prefix` and `reference_counter`, and constrained by `UNIQUE (organisation_id, reference)`. What the specification does not state is the three things an implementation must decide: the zero-padding width, the moment the counter increments, and how concurrent submissions avoid colliding. The uniqueness constraint means getting the last of those wrong is not a cosmetic bug but a failed insert on a user's submission.

**Decision**
References are `{prefix}-{counter}` with the counter zero-padded to six digits, matching the width of the `LAP-000123` example the specification gives throughout.

The counter increments **at submit**, not at draft creation. A draft that is never submitted therefore consumes no reference, which matters because `PRD.md` §11.5 has `POST /cases` create a draft and a separate `POST /cases/:id/submit` pin the version and start the engine: drafts are expected to be abandoned, and a catalogue of references pointing at cases that never existed would be noise in every subsequent audit and report.

Allocation is a single `UPDATE process_definitions SET reference_counter = reference_counter + 1 ... RETURNING reference_prefix, reference_counter`, executed inside the caller's submit transaction. Postgres holds a row lock for the duration of the statement, so two concurrent submissions against the same definition serialise and receive different numbers.

**Consequences**
Because allocation joins the submit transaction, a submission that fails after allocating leaves a permanent gap in the sequence rather than returning the number to a pool. That is the correct trade and is deliberate: a reference that once identified an attempted submission must never later identify a different case, or the audit trail becomes ambiguous precisely where it is most load-bearing. References are consequently sequential but not gapless, and nothing downstream may infer a case count from the highest reference issued. Six digits accommodate 999,999 cases per definition; past that the format widens rather than wrapping, and the `UNIQUE` constraint would surface the problem loudly rather than silently reusing a number. The counter lives on `process_definitions`, so it is per definition and per organisation, not global: two organisations both running a laptop request each have their own `LAP-000001`, which the uniqueness constraint being scoped to `(organisation_id, reference)` already anticipates.

**Alternatives rejected**

- **`SELECT` the counter, then `UPDATE` it.** Rejected outright: a textbook read-modify-write race. Two concurrent submissions read the same value and both attempt the same reference, and the `UNIQUE (organisation_id, reference)` constraint turns that race into a user-visible failed submission rather than a silent corruption. That it fails loudly is not a defence of the approach.
- **A Postgres sequence per definition.** Rejected: sequences are non-transactional by design, so a rolled-back submission still consumes a number (the same gap behaviour, with no benefit), and creating one sequence per definition means DDL at definition-creation time, which makes definitions a schema-migration concern rather than ordinary data.
- **Allocate at draft creation.** Rejected: every abandoned draft would burn a reference, and `PRD.md`'s flow explicitly separates draft creation from submission.
- **A random or UUID-derived reference.** Rejected: the reference exists to be quoted by a human in an email or a support call. `PRD.md` §14.2's mandated subject-line format, `LAP-000123 Approval needed: Laptop request`, presumes something short and readable.

## ADR-0014: Groups carry a stable key, separate from their display name

**Date:** 2026-08-16
**Status:** Accepted
**Deciders:** Project operator (in absence; flagged for review on return)

**Context**
`PRD.md` §4's definition document assigns a workflow step with `{ strategy: 'group', groupKey: 'itSupport' }`, and §7 resolves that strategy to the group's active members. But §2's `groups` table has no key at all: `group_id`, `organisation_id`, `name`, `description`, with `UNIQUE (organisation_id, name)`. There was therefore nothing for `groupKey` to resolve against except the display name. This surfaced building the Cases API, where `EvaluationContext.directory.groupIdsByKey` has to be populated before the engine can resolve any group assignment, because `packages/core` performs no I/O and cannot make the lookup itself.

Resolving against the name works until somebody renames a group. A published definition version is immutable and a case executes the version it was submitted against forever (§8), so the pinned document keeps naming the old value while the group answers to a new one, and every future case on that definition falls into `unassigned` for a reason nobody would connect to a rename weeks earlier. The same schema already distinguishes the two concepts: `process_definitions` carries both a `key`, commented "stable slug", and a separate `name`.

**Decision**
`groups` gains `key TEXT NOT NULL` with `UNIQUE (organisation_id, key)`, added by the `group-keys` migration, which backfills existing rows from `name` before applying the constraint. A definition document's `groupKey` resolves against `groups.key`, never against `groups.name`, and `name` becomes purely a display concern that may change freely. `findGroupIdsByKeyForCurrentTenant` in `packages/db` is the single place that builds the mapping, and it is tenant-scoped like every other repository function, so two organisations may both hold a group keyed `itSupport` and each resolves to its own.

**Consequences**
Renaming a group can no longer break a pinned definition version, which is the property §8 calls the most important correctness property in the product. The cost is that group creation now supplies two values instead of one, and the group management endpoints in §11.2, which are not built yet, must expose `key` as write-once rather than editable, since making it editable would reintroduce exactly the breakage this removes. This is a deviation from `PRD.md` §2's table as literally written, recorded here rather than made quietly: the specification's own document format in §4 requires a key, so the table was incomplete rather than the requirement being new.

**Alternatives rejected**

- **Resolve `groupKey` against `groups.name`, as the schema as written forces.** Rejected for the rename problem above. It was the option that required no migration, and it would have worked indefinitely right up to the first rename, at which point the failure appears far from its cause and looks like an engine defect rather than a data one.
- **Name the seeded group `itSupport` so name and key coincide.** Rejected: it does not solve anything, it only postpones the collision by making the display name unusable in the interface, and the first person to correct "itSupport" to "IT Support" in a group settings screen would break every laptop request.
- **Keep a separate mapping table from group key to group id.** Rejected on the same grounds ADR-0011 rejected its equivalent: a second source of truth that must be kept in step with every insert and delete on the table it mirrors, for a column's worth of information.

## ADR-0015: Case visibility refuses with 404, and "owned process" means the definition's creator

**Date:** 2026-08-16
**Status:** Accepted
**Deciders:** Project operator (in absence; flagged for review on return)

**Context**
`PRD.md` §12.3 defines two permissions and insists they are always evaluated separately. Actionability is precise and needed no interpretation: the resolved assignee, an active delegate, or a member of the assigned role or group for an unclaimed task. Visibility is looser: "submitter, current or past assignee, process owner of the definition, or admin". Building the Tasks API forced two questions the specification does not answer.

First, what a refusal looks like. §11.10 mandates `404, never 403` for cross-tenant access, and gives the reason: a `403` confirms the resource exists. It says nothing about a case inside your own organisation that you are simply not entitled to see, and the Cases API as first built did not enforce visibility at all, treating tenant membership as sufficient.

Second, what "process owner of the definition" means. There is no ownership table and no owner column. `process_definitions.created_by_user_id` is the only thing in the schema that associates a person with a definition, and `processOwner` is a role in §12.2 held per organisation rather than per definition.

**Decision**
A case the requester may not see returns `404` with the same body as a case that does not exist, exactly as a cross-tenant read does. The reasoning §11.10 gives for the cross-tenant case applies unchanged within a tenant: an ordinary member probing case identifiers learns nothing from a uniform `404`, whereas a `403` would confirm that a colleague has an open disciplinary case even though its contents stay hidden.

"Process owner of the definition" resolves to holding the `processOwner` role **and** having created that definition (`created_by_user_id`). Holding the role alone is not enough.

Actionability keeps its own refusal code. A `403` there is correct and deliberate, because it is only ever reached once visibility has already been granted, so the task's existence is not news to the caller.

Both checks read membership from the database on every request rather than from the session's `roles` claim, which is a snapshot taken at sign-in and can be up to twelve hours stale under ADR-0010.

**Consequences**
Visibility is enforced in one place, `requireVisibleCase`, which every case read passes through, so a new endpoint that forgets it is a visible omission rather than a silent leak. The `404`-for-invisible choice means a legitimate user who loses access mid-session sees "no such case" rather than a clearer explanation, which is a real usability cost accepted for the disclosure property.

Reading `processOwner` as role-plus-creator is the narrow interpretation. If it proves too narrow, for example once definitions can be transferred between owners, the fix is a proper ownership column or table, and this ADR is superseded rather than the check quietly widened. Widening it to "any processOwner sees every case" would make the role equivalent to `admin`, which §12.2 clearly does not intend, since it lists them as separate rows with escalating capability.

Two membership queries per request are added to the hot path. That is the price of not trusting a twelve-hour-old claim for an authorisation decision, and both are single-row lookups on an indexed, tenant-scoped table.

**Alternatives rejected**

- **Return `403` for an in-tenant case the user may not see.** Rejected: it confirms the case exists to anyone who can guess or enumerate an identifier, which is precisely the disclosure §11.10 rules out one boundary further out. The argument does not weaken just because the boundary moved from between organisations to within one.
- **Treat tenant membership as sufficient to view any case, as the Cases API first did.** Rejected: it makes every expense claim, grievance and access request in the workspace readable by every member, and §12.3 exists specifically to prevent that.
- **Let any `processOwner` see every case.** Rejected: collapses the distinction between `processOwner` and `admin` that §12.2 draws.
- **Trust the session's `roles` claim instead of querying membership.** Rejected: a revoked role would keep working until the session expired, up to twelve hours later, which is the wrong failure direction for an authorisation check. Sessions are not revocable under ADR-0010, so the claim cannot be corrected mid-life.

## ADR-0016: Notification delivery is claimed with a leased row, not a bare uniqueness check

**Date:** 2026-08-16
**Status:** Accepted
**Deciders:** Project operator (in absence; flagged for review on return)

**Context**
`PRD.md` §14.2 requires delivery to be idempotent, keyed on `eventId` plus `recipientUserId` plus `templateKey`, and `PRD.md` §10 requires every consumer to be idempotent on `eventId`. SQS is at-least-once by design, so the worker will see the same message again, and the build order asks for that property to be proven by a test that delivers the same message twice.

The obvious implementation, an `INSERT ... ON CONFLICT DO NOTHING` on the unique idempotency key treating any conflict as "already handled", is wrong in a way that only shows up in failure. It conflates three different situations: the notification was delivered, another delivery is working on it right now, and a previous attempt claimed the row and then failed to send. Treating the third as "already handled" means a single transient email outage loses that notification permanently, because no later redelivery will ever try again. Treating it as "retry it" instead reintroduces duplicates, since the first caller has inserted its row but not yet marked it sent, so a concurrent second caller reads `queued` and sends a second copy.

**Decision**
Claiming a notification returns one of three outcomes: `claimed`, `alreadyDelivered`, or `inFlight`, and only `claimed` sends.

The claim is attempted as an insert first. On conflict, a second statement tries to reclaim the existing row, matching only a row whose status is `failed`, or one that is still `queued` but was created more than a five-minute lease ago. An in-flight attempt is therefore invisible to the reclaim while an abandoned one is not. If neither statement yields a row, the existing row is read and its status decides between `alreadyDelivered` and `inFlight`.

Separately, the handler decides which template applies from the **event payload**, never from the current task row. The row is mutable: somebody claims a pool task and `assignee_user_id` stops being null.

**Consequences**
A failed send is retried by the next redelivery rather than lost, and two concurrent redeliveries still produce exactly one email, which the integration suite asserts directly rather than by inspection.

The lease is the part to be honest about. A worker killed between claiming a row and sending its email strands that notification for up to five minutes, and if the queue has already exhausted its redelivery attempts by then, it is stranded permanently at `queued`. That is a narrower window than the alternative designs leave open, but it is not zero, and a `queued` row older than the lease with no message left on the queue is the shape of that failure. Making it zero needs a sweeper over stale `queued` rows, which is worth adding when there is an operational reason to, not before.

Resolving the template from the payload also means the notification describes the event as it happened rather than the world as it now is. A pool task claimed before the notification goes out still notifies the whole pool. That is the correct trade: the alternative silently breaks idempotency, and it is what was actually observed running the worker against the real queue.

**Alternatives rejected**

- **Treat any conflict on the idempotency key as "already handled".** Rejected: loses a notification permanently on any transient send failure. This was the first implementation, and the flaw was not hypothetical.
- **Retry anything not yet marked sent.** Rejected: duplicates under concurrency, caught by the three-way concurrent delivery test rather than by review.
- **A dedicated `claimed_at` or lock column.** Rejected for now: `created_at` plus `status` already carries enough to express the lease, and a column that exists only to hold a lock invites the assumption that a distributed lock is being maintained, which it is not.
- **Resolve the recipient and template from the task row at delivery time.** Rejected: the row is mutable, so a redelivery after a claim computes a different template key, which is a different idempotency key, which sends a duplicate. Observed in the live run before it was fixed.

## ADR-0017: One dark palette, with each semantic hue in a solid and a subtle tier

**Date:** 2026-08-16
**Status:** Superseded in part by ADR-0020
**Deciders:** Project operator (design direction supplied as Cloudflare dashboard screenshots)

> ADR-0020 reverses this ADR's "single palette, no `prefers-color-scheme` block" decision
> only. Everything else here still holds and is not restated there: the four-token solid
> and subtle tiers, brand kept distinct from primary, literal `oklch()` values so
> `tokens.test.ts` can parse and check them, and the lint rule banning raw colours.

**Context**
`CLAUDE.md` §5.3 already required every colour to be a design token consumed through the Tailwind theme, and the token file that existed was the light neutral shadcn default declared solely on `:root`. The operator then supplied a visual direction: the Cloudflare dashboard, dark-first, and asked that `apps/web` follow it while taking OrgFlow's own brand hue rather than Cloudflare's orange.

Adopting a dark surface breaks an assumption the light default never had to face. On white, one red serves both as a button fill carrying white text and as error text on the page, because both readings sit on the same side of the surface. On a near-black background they pull in opposite directions: a red dark enough for white text at 4.5:1 sits at roughly the same lightness as the page, and a red light enough to read as text against the page cannot carry white text at all. The same is true of green, amber and the action blue. `CLAUDE.md` §3 makes WCAG 2.2 AA a completion criterion rather than a follow-up, so this could not be settled by choosing whichever value looked closest to the screenshots.

There is a second, independent collision. In the reference, the brand colour marks identity (the mark, the panel beside the sign-in form) and blue marks interaction. The existing token set had no way to express that difference, because `--primary` was the only token meaning "the product's colour", so brand and action would have had to be the same value.

**Decision**
`packages/ui/src/tokens.css` is a single dark palette. There is no light set and no `prefers-color-scheme` override: the product has one look, and a theme swap replaces the file wholly, as `CLAUDE.md` §5.2 already anticipates for a GOV.UK theme.

Each semantic hue is declared in four tokens rather than two:

    --x                    solid fill
    --x-foreground         text on that fill
    --x-subtle             tinted surface
    --x-subtle-foreground  text on that tint, and on background or card

`--brand` is separate from `--primary`, and `--link` is separate from both, because a blue that carries white button text is too dark to read as link text on a dark page.

Every value is a literal `oklch()` triple rather than a `var()` alias, because `packages/ui/src/tokens.test.ts` parses this file, converts each token to a WCAG relative luminance and asserts the real contrast ratio of every foreground-against-surface pair, plus that every colour lies inside the sRGB gamut. Aliases would read more tersely and could not be checked.

**Consequences**
The palette is verified rather than asserted. The test found a real defect on its first run: `--link-hover` was outside the sRGB gamut, so the browser would have clamped it to a colour no ratio had been measured against. Contrast is now a property of the token set, checkable before the pages that consume it exist, which is the only point at which a whole palette can be checked at once. `axe-core` in the Playwright suite still runs per page and catches what a palette cannot know, such as text placed on the wrong surface.

The cost is that a component author must pick the right tier, and picking the wrong one produces a page that passes lint and fails axe. The four-token shape and the naming are what make the choice obvious; the alternative was two tokens and a rule that some of the pairings silently fail.

Dropping the light theme means a user who prefers light gets dark anyway. That is a real accessibility consideration, not merely a preference, and it is accepted for now because a second palette doubles the surface `tokens.test.ts` has to hold for a theme nothing has asked for. Adding one later is additive: the pairs are already enumerated.

The exact greys of the reference are not reproduced. The muted secondary text tier sits at `oklch(0.7 …)` rather than the darker grey the screenshots use, because the screenshots' value fails 4.5:1 against both the page and the card. The structure, the dark shell, the card language and blue-as-action all survive; the specific greys do not.

`CLAUDE.md` §5.3's claim that raw colours are "enforced by lint rather than by review" was not previously true. It is now: `eslint.config.mjs` rejects hex literals, `rgb()`/`hsl()`/`oklch()` calls, direct Tailwind palette classes and absolute white or black, in both string literals and template chunks, throughout `apps/web` and `packages/ui`.

**Alternatives rejected**

- **Light and dark palettes with a `prefers-color-scheme` override.** Rejected for now: it doubles every contrast pair the test holds, for a theme not asked for. Recorded here as the obvious extension rather than a closed door.
- **Two tokens per hue, as the light default had.** Rejected: on a dark surface a single value cannot both carry white text and read as text. This is arithmetic, not taste.
- **Colour-matching the reference screenshots.** Rejected: several of its greys fail 4.5:1, and `axe-core` passing with zero violations is a completion criterion. The look was adopted, the values were recomputed.
- **Reusing `--primary` as the brand colour.** Rejected: it makes "this is OrgFlow" and "this does something" the same colour, which is the one structural claim the reference design makes about its own palette.
- **Deriving subtle tints with opacity utilities such as `bg-success/10`.** Rejected: the colour that actually renders depends on whatever sits behind it, so no ratio can be measured. The previous `Alert` did this, and it is why the tints are now real tokens.

## ADR-0018: apps/web may import packages/core

**Date:** 2026-08-16
**Status:** Accepted
**Deciders:** Project operator (asked and answered during the catalogue build)

**Context**
`CLAUDE.md` §3 and `TECH-STACK.md` §2 fix the dependency direction as
`types → core → db/documents/events → api/workers`, with `web` importing only `types` and
`ui`, enforced by `eslint.config.mjs`. The stated purpose of the web restriction is that
the browser bundle never contains server code.

The form runtime broke the assumption behind the rule rather than the rule's purpose. A
`FormField` carries an optional `visibleWhen` condition, and the seeded Laptop Request uses
two of them: `otherModelDetail` appears only when the chosen model is `other`, and `quote`
only above £1,000. That visibility has to be recomputed as the requester types, so it
cannot be a round trip to the API, and it is evaluated by `evaluateCondition` in
`packages/core`, which the browser could not reach.

**Decision**
The rule becomes `web → types, core, ui`.

`packages/core` is not server code. `CLAUDE.md` §3 requires it to perform no I/O at all:
no database, no HTTP, no AWS SDK, not even `Date.now()`, with time injected through the
evaluation context. Its only dependency is `@orgflow/types`. It is therefore isomorphic by
construction, and the restriction's purpose survives intact: the browser still contains no
database client, no AWS SDK and no HTTP handler.

The form runtime supplies the browser's own `EvaluationContext` and calls the same
function the engine calls.

**Consequences**
There is one condition evaluator, so the browser and the server cannot disagree about
whether a field was visible. That disagreement is the failure this avoids, and it is not
cosmetic: a field the browser hides but the server treats as visible and required produces
a case missing an answer the requester was never asked for.

`packages/core` now has a second consumer with different constraints, so it acquires a
bundle-size and browser-compatibility obligation it did not have before. That is a real
cost. It is bounded by the no-I/O rule already in force, which is what keeps the package
small and dependency-free in the first place.

One context reference cannot be resolved in the browser. `PRD.md` §5.2 defines five, and
four are available client-side: `$submitter.roles` from the session, `$case.daysOpen` and
`$step.escalationLevel` are both zero on a new draft by definition, and `$now` is the
clock. `$submitter.department` is not on the session. Rather than evaluate it against a
wrong value, `apps/web/src/features/cases/visibility.ts` walks the condition tree and shows
any field that mentions it. The direction of that failure is deliberate: showing a field
that turns out to be hidden costs one unnecessary question, whereas hiding one the server
requires produces an incomplete case. The server remains authoritative either way.

**Alternatives rejected**

- **Reimplement condition evaluation inside `apps/web`.** Rejected: two implementations of
  a tenant-authored expression language will diverge, and the divergence is silent until a
  case is submitted with the wrong fields. It would also need its own conformance suite to
  stay honest, which is more work than the dependency edge costs.
- **Ask the API which fields are visible.** Rejected: visibility changes on keystrokes, so
  every answer becomes a network round trip and fields flicker behind latency.
- **Extend the session to carry `department`, and evaluate everything locally.** Not
  rejected outright, but not needed: it changes a shipped API contract to remove a
  fail-open path that is already safe. Worth revisiting if a real definition depends on a
  department condition in a form.

## ADR-0019: ECS Fargate for the API, Lambda for the notification worker

**Date:** 2026-08-16
**Status:** Accepted
**Deciders:** Project operator (session continuation after step 10; asked to proceed)

**Context**

`TECH-STACK.md` §7 names `ApiStack` and `WorkersStack` but leaves the API's compute
choice open ("Lambda + API Gateway, or ECS Fargate") and states the worker's ("Lambda
functions, event source mappings"). `PRD.md` §20's own Phase 1 acceptance criterion
settles the worker question explicitly: "the approver receives an email via SNS -> SQS ->
Lambda -> SES." Building step 11's deployment skeleton meant making the API's choice for
real, and then discovering that `workers/src/main.ts`'s existing local development driver,
a self-managed `ReceiveMessage`/`DeleteMessage` poll loop, is not what a Lambda deployment
actually runs: an SQS event source mapping has AWS itself pull messages and invoke the
function with a batch, so nothing in `main.ts` carries over unchanged.

`apps/api/src/index.ts` is a long-running Express process that opens its Postgres pool and
Mongo client once at startup and holds them for the process lifetime. Wrapping that in a
Lambda handler would mean either reopening a connection pool on every cold start, the
opposite of what a persistent pool is for, or a rewrite of already-tested server bootstrap
code to defer that setup per-invocation.

**Decision**

`ApiStack` runs the API on ECS Fargate, behind an internet-facing Application Load
Balancer, built from a new multi-stage `apps/api/Dockerfile` using `turbo prune` to isolate
exactly the workspace packages `@orgflow/api` depends on. `WorkersStack` runs the
notification worker as a single Lambda function (Node.js 22, ARM64, matching
`TECH-STACK.md` §5.1), triggered by an SQS event source mapping on the `notifications`
queue with `reportBatchItemFailures` enabled.

The event source mapping needed a genuine adapter, not a reuse of the poll loop:
`workers/src/lambda-handler.ts` is new, exports `handler(event: SQSEvent):
Promise<SQSBatchResponse>`, and calls the same `dispatchDomainEvent` the local driver
calls. `reportBatchItemFailures` is what lets it report only the records that actually
failed rather than the SQS-default "retry the whole batch on any non-empty return", the
Lambda equivalent of `pollOnce`'s per-message delete. `main.ts`'s email-sender construction
was extracted to `workers/src/email/resolve-sender.ts` so the two entry points cannot
disagree about which implementation they built.

Getting the Dockerfile right needed three real, empirically found fixes, not guessed ones:
`--ignore-scripts` on both `pnpm install` calls (the root `package.json`'s own `prepare`
script runs `husky`, a devDependency `turbo prune`'s pruned tree does not carry);
`tsconfig.base.json` copied explicitly into the build stage (`turbo prune` walks
`package.json` dependencies, not a `tsconfig`'s `extends` target, so every pruned
package's tsconfig pointed at a file that was not there); and `apps/api/node_modules`
copied alongside the root one into the runtime stage (pnpm places the workspace symlinks,
`@orgflow/db -> ../../../packages/db`, inside the _consuming package's own_ `node_modules`,
not the root one, so a build that copied only the root layer looked complete and then
failed at boot with `ERR_MODULE_NOT_FOUND`). The built image was run against the real
Postgres and Mongo containers this session already had up, confirmed serving `GET /health`
and completing a real `dev-login` database write, not merely confirmed to build.

`NetworkStack` gains a third subnet group, `app` (`PRIVATE_WITH_EGRESS`), with one NAT
gateway. Neither Fargate nor the Lambda could reach the internet without it: MongoDB
Atlas is the definition store's actual deployment target (`TECH-STACK.md` §5.2, "DocumentDB
... is not API-complete. That is noted as a constraint, not a plan."), meaning it sits
outside the VPC entirely, and the Google OIDC discovery endpoint `apps/api` calls at boot
is likewise public internet. `DataStack`'s Postgres security group gains an ingress rule
scoped to the `app` subnet group's CIDR blocks rather than to a security group reference,
because `DataStack` is built before `ApiStack` or `WorkersStack` exist, and a
security-group-to-security-group rule would need one of their security groups as an input,
making `DataStack` depend on a stack that already depends on `DataStack`. The same cyclic
shape surfaced a second time, empirically, as a real `DependencyCycle` synth failure: the
first version of `ApiStack`'s two application secrets (a MongoDB URI placeholder and the
session secret) used `DataStack`'s shared customer-managed KMS key, and granting the
execution role read access to a secret on that key would have needed the key's resource
policy, owned by `DataStack`, to name a role owned by `ApiStack`. Both now use the default
AWS-managed `secretsmanager` key, matching how `rds.Credentials.fromGeneratedSecret`
already does in the same file.

Three secrets are deliberate placeholders, not generated credentials: `DataStack`'s
`databaseUrlSecret` (an assembled `postgres://...` connection string) and `ApiStack`'s
`mongoUriSecret` both describe a value nothing in this CDK app can compose. RDS's own
generated secret holds a real, rotating username and password, but CloudFormation has no
built-in way to combine one secret's fields into another's value without either embedding
a password in the template, which CDK's own documentation warns against, or a custom
resource this synth-only skeleton does not yet need. Both are set by hand once, the first
time a given environment is actually deployed, the same way `sesDomain` and `webUrl`
(`infra/src/config/environment.ts`) are `.example` placeholders (RFC 2606) until `WebStack`
owns a real, DNS-controlled domain. `WorkersStack`'s Lambda receives the database secret's
ARN as a plain environment variable and a read grant, rather than the composed value
itself: unlike ECS's `secrets` mapping, which never exposes a secret's value outside the
running container's process environment, a Lambda environment variable sourced from
Secrets Manager is resolved into the function's visible configuration at deploy time,
which defeats the purpose of keeping it in Secrets Manager at all. Fetching it via the SDK
at cold start is the correct pattern and is not yet built; `resolveDeps` in
`lambda-handler.ts` is where it belongs.

Every `cdk-nag` finding against the two new stacks was suppressed from an actual run, not
predicted: an earlier draft guessed rule IDs and a resource path before ever running
`cdk-nag`, and every one of those guesses was wrong or incomplete once checked against real
output (a debugging script written for this session printed exact resource paths before
any suppression was written, then was deleted). The load balancer's listener is HTTP only:
an HTTPS listener needs an ACM certificate, which needs a real, DNS-validated domain, which
does not exist yet either.

**Consequences**

`cdk synth -c env=dev` succeeds with exit code 0 and zero unsuppressed `cdk-nag` findings
across all six stacks (Network, Data, Messaging, the new Assets, Api, Workers), confirmed
by running the real command, not only the snapshot test that mirrors it.
`infra/test/stacks.test.ts` takes an injected `apiImage: ecs.ContainerImage` on `ApiStack`
specifically so that suite stays fast and offline: `bin/app.ts`'s real synth path builds a
`DockerImageAsset` from `apps/api/Dockerfile`, while the test passes a tiny public-registry
stub, since neither the template shape nor `cdk-nag` cares whether the referenced image
could actually serve traffic. One finding, the execution role's `ecr:GetAuthorizationToken`
wildcard, only appears against the real image and is invisible to the stub-based test; its
suppression was written and verified against the real `cdk synth` output for exactly that
reason.

Nothing here is deployed. The manually-populated secrets are a real operational gap for
whoever runs the first actual deployment, not a solved problem, and are named as such
rather than silently assumed away. `ApiStack`'s HTTP-only listener and every `.example`
placeholder move once `WebStack` exists.

**Alternatives rejected**

- **Lambda + API Gateway for the API.** Rejected: `apps/api` already holds its database and
  Mongo connections open for the process lifetime by design; adapting that to a
  per-invocation Lambda lifecycle is a rewrite of tested server bootstrap code for no
  benefit this skeleton needs, and `TECH-STACK.md` §7 names Fargate as an equally valid
  alternative rather than mandating Lambda for API compute specifically.
- **Keep the notification worker as a long-running poll loop on ECS instead of Lambda.**
  Rejected: `PRD.md` §20 explicitly commits to "SNS -> SQS -> Lambda -> SES" as a Phase 1
  acceptance criterion, and nothing about the worker holds a connection open the way
  Express does, so there is no persistent-pool argument against Lambda the way there is for
  the API.
- **A shared customer-managed KMS key for the new application secrets.** Rejected: this is
  the exact cyclic cross-stack dependency `MessagingStack`'s own `EncryptionKey` comment
  already warns about, confirmed as a real `DependencyCycle` synth failure rather than a
  theoretical one.
- **Compose `ORGFLOW_DATABASE_URL` automatically via a custom resource.** Not rejected
  outright, deferred: correct, but a bigger deliverable than a synth-only, not-deployed
  skeleton needs. Recorded above as the follow-up it is.
- **Guess `cdk-nag` rule IDs and suppress ahead of running the checker.** Rejected after
  one draft did exactly this and got several wrong; every suppression in
  `infra/src/nag-suppressions.ts` for the two new stacks was written after seeing the
  actual `AwsSolutions-*` id and resource path in real output.

## ADR-0020: A light palette and a three-state theme choice

**Date:** 2026-08-16
**Status:** Accepted
**Deciders:** Project operator (asked for a light/dark switch, and for the account menu)

**Context**

ADR-0017 committed to a single dark palette with no `prefers-color-scheme` block, on the
explicit reasoning that "a second palette would double the contrast surface that
`tokens.test.ts` has to hold, for a light theme nothing has asked for." Something has now
asked for it. That ADR's own stated condition for revisiting is met, so this supersedes
that one decision and leaves the rest of it standing.

**Decision**

`packages/ui/src/tokens.css` carries both palettes. The product stays dark-first, so the
bare `:root` holds the dark values unguarded and the light palette is the one behind a
guard; a light-first product would use the identical technique with the roles swapped.

The choice has three states, not two. "Match device" is a real state meaning "keep
following the system as it changes", distinct from having picked whichever theme the system
happens to resolve to today, and it is the default. It is represented by the **absence** of
a `data-theme` attribute and the absence of a stored key, which is what lets the
`prefers-color-scheme` media query apply at all. An explicit choice sets
`data-theme="light"` or `"dark"` on `<html>`, which wins over system preference in both
directions.

The light palette's values were computed, not chosen. Every one of the 42 contrast pairs
`tokens.test.ts` checks was run against candidate values before any of them shipped, and
ten of the first candidates were outside the sRGB gamut, which matters because a clamped
token is not the colour whose ratio was measured. `tokens.test.ts` now parses all four
blocks in the file and checks both palettes against the identical pair list, plus two
cross-checks that the duplicated dark and light blocks never drift from each other. Brand
and the interactive blue keep the same hue in both palettes so OrgFlow reads as one product
across themes; only lightness and chroma move.

An inline script in `<head>` applies a stored choice before first paint. This is the one
place a blocking synchronous script is the right tool, because nothing else runs early
enough to prevent a flash of the wrong palette. `globals.css`'s `color-scheme` follows the
same four selectors in lockstep, so browser-drawn furniture (scrollbars, date pickers,
autofill, the caret) matches; getting that wrong is a real contrast failure on controls the
token system never touches.

`ThemeProvider` reads the DOM attribute through `useSyncExternalStore` rather than
`useState` plus `useEffect`. The effect version is what the `react-hooks` lint rule rejects
as a cascading render, and it is genuinely the wrong shape: the attribute is external state
being read, not React state needing a correction pass.

The application shell's top bar was rebuilt around this: an icon theme control and an
avatar that opens an account menu, both built on Radix (which is what shadcn/ui itself is
built on, so within `CLAUDE.md` §5.3's mandated system rather than a substitution). A menu
owes the user roving arrow-key movement, type-ahead, Escape, click-outside, focus returning
to the trigger, and correct `menu`/`menuitemradio` roles; every one is something a
hand-rolled dropdown gets subtly wrong.

**Consequences**

Both palettes are verified rather than asserted, and the light one is checked on a
data-heavy page (the approvals queue, which exercises the status badges and urgency tones)
rather than only on the mostly-empty dashboard.

The no-flash claim is tested in a way that could actually fail: the spec blocks Next's
client bundles so React never hydrates, then asserts the theme is still correct. Without
that, asserting the attribute after a normal reload would pass even with the head script
deleted, because the provider would reach the same end state a moment later and the test
would never see the flash. An earlier attempt to measure this with `page.addInitScript`
was abandoned once it proved to be observing Playwright's initial empty document rather
than the real one, which made it structurally incapable of failing correctly.

One flash is unavoidable and is not papered over. The server cannot read `localStorage`, so
it always renders "Match device" as selected, and hydration corrects that a frame later for
anyone with a stored choice. The correction cannot be removed; the `transition-colors` that
turned it from an imperceptible snap into a visible fade was, and the reason is recorded at
the call site. It was found by looking at a screenshot, not by reasoning about the code.

`/settings` and `/settings/profile` exist because the account menu links to them, and a menu
item pointing at a page that is not built is worse than no item. Both carry real content
from the session rather than being placeholders. Profile is explicitly read-only: name and
email come from the identity provider (ADR-0002), so an edit form there would either
silently do nothing or be overwritten at the next sign-in, and the page says so.

**Alternatives rejected**

- **A two-way sun/moon switch.** Rejected: it cannot express "match device", which becomes
  unreachable the moment a user touches either side of a binary control. The trigger icon
  shows the _setting_ rather than the resolved appearance for the same reason: which theme
  you are looking at is already visible, whether it will follow the device tomorrow is not.
- **`useState` plus `useEffect` in the provider.** Rejected: flagged by
  `react-hooks/set-state-in-effect`, and the rule is right that reading external state is
  what `useSyncExternalStore` is for.
- **Colour-matching the dark palette's values by inverting lightness.** Rejected: ten
  candidate values landed outside the sRGB gamut, and several pairs that pass on dark do
  not pass on light. Both palettes were computed against the real pair list independently.
- **A hand-rolled dropdown to avoid a dependency.** Rejected: Radix is what shadcn/ui is
  built on and `@radix-ui/react-label` and `@radix-ui/react-slot` are already in use, so
  this is the existing component system rather than a new one.
- **Keeping the dark-only palette and declining the request.** Rejected for the obvious
  reason, and recorded only because ADR-0017 argued the opposite case and the register
  should show why that argument no longer holds.

## ADR-0021: Three type roles, one loaded from Google's CDN, and a true-black dark theme

**Date:** 2026-08-16
**Status:** Accepted
**Deciders:** Project operator (specified both typefaces and "dark theme should be 100% dark")

**Context**

The operator asked for Bricolage Grotesque on titles, Google Sans Flex on body text, and a
dark theme that is fully dark rather than the lifted near-black ADR-0017 chose.

`CLAUDE.md` §5.2 requires interface typefaces to come from Google Fonts "loaded through
`next/font/google`. Self-hosted and subset at build time, so no runtime request to Google
and no layout shift." Bricolage Grotesque satisfies that directly. Google Sans Flex does
not, and the reason is worth recording rather than discovering again later: it is absent
from `next/font/google`'s catalogue (checked against the bundled `font-data.json`: 1,862
families, no match; the only near hit is "Google Sans Code", a monospace face), and it is
absent from the `google/fonts` repository under `ofl/`, `apache/` and `ufl/` alike, all
three returning 404. Google's CSS API does serve it, as a variable font with weight 1-1000
and an optical-size axis. So it is distributed, but not under an open licence.

That combination rules out the obvious approach. Self-hosting it means committing font
files with no licence permitting redistribution into the repository, which is a legal
exposure this project should not take on silently.

**Decision**

Three type roles, deliberately distinct, all consumed as tokens so no component names a
typeface:

    --font-sans     body and UI text        Google Sans Flex   CDN
    --font-display  headings, h1-h4         Bricolage Grotesque next/font/google
    --font-mono     references, identifiers JetBrains Mono      next/font/google
    --font-brand    the logo wordmark only  Space Grotesk       next/font/google

Google Sans Flex is loaded with a plain `<link>` to `fonts.googleapis.com`, with
`preconnect` to both `fonts.googleapis.com` and `fonts.gstatic.com` (the second needs
`crossOrigin`, because font files are fetched in CORS mode and a preconnect whose mode does
not match opens a second useless connection). Nothing is committed to the repository, so
there is no redistribution and no licensing exposure. The operator chose this over
self-hosting after being shown the licensing position.

`--font-brand` exists separately from `--font-display` for a specific reason: the operator
drew the OrgFlow logo in Space Grotesk, and it would be wrong for a decision about the
heading typeface to silently redraw their brand mark. The full lockup only appears on the
sign-in page, so that face is fetched only where the wordmark actually renders.

Headings take the display face through an `h1, h2, h3, h4` rule in `globals.css` rather
than a class on each heading component, so a heading rendered anywhere (`CardTitle`,
`PageHeader`, `EmptyState`, a page's own `h1`) picks it up without every author
remembering. Same reasoning as the global `:focus-visible` rule beside it.

The dark theme's page background becomes `oklch(0 0 0)`, true black. The surface ramp above
it is compressed downward to keep elevation legible: sidebar 0.11, card and popover 0.14,
muted 0.18, accent and secondary 0.22, border 0.24. The four subtle tints come down with
them, and `--warning-subtle` lost chroma (0.06 to 0.05) because at the new lightness the
old value fell outside the sRGB gamut. Both dark blocks in `tokens.css`, the bare `:root`
and the explicit `[data-theme="dark"]`, were changed together; the cross-check test added
in ADR-0020 is what guarantees they stayed identical.

**Consequences**

All 96 token contrast tests pass unchanged, and every one of the 42 pairs was re-verified
against the new dark values before the file was edited. Contrast against the page
background only improves on true black; the pairs that needed attention were the subtle
tints, which sit on `--card` rather than on the page.

The cost of the CDN is real and is the thing to remember. Every visitor makes a runtime
request to Google before body text can render in its intended face, `display=swap` means a
visible swap rather than a blocked paint, and both are exactly what `next/font` exists to
prevent. The `preconnect` pair reduces the latency but does not remove the dependency: if
`fonts.googleapis.com` is unreachable, body text falls back to the system sans and the
product still works. Headings, monospace and the wordmark are unaffected, because those
three are self-hosted.

Elevation on true black is subtler than on the old lifted background: `--card` against
`--background` is a 1.05:1 luminance step, where before it was a comparison between two
greys. That is inherent to the request and is why the border weights were kept while the
surfaces moved. Depth now comes mostly from the hairline border, as `tokens.css` already
described it doing.

The E2E theme suite asserts the rendered background is `oklch(0 0 0)`, so a later drift
back to a lifted grey fails a test rather than passing unnoticed.

**Alternatives rejected**

- **Self-host Google Sans Flex via `next/font/local`.** This is the technically superior
  option and would have kept §5.2 fully intact. Rejected because it requires redistributing
  a font with no open licence, which is the operator's call and not a default worth
  assuming.
- **Substitute an OFL lookalike (DM Sans, Figtree).** Offered as the recommendation, since
  it would have kept every §5.2 guarantee at no licensing or performance cost. The operator
  chose the real typeface over the compromise; recorded so the trade is visible.
- **Use `--font-display` for the logo wordmark too.** Rejected: it would reduce the system
  to three families, but at the cost of silently changing a brand asset the operator drew,
  which is not a side effect a typography decision should have.
- **A near-black background rather than true black.** That is what ADR-0017 chose and what
  this reverses, on request. Recorded because the older ADR argues for the lifted value on
  elevation grounds, and the trade-off it describes is genuine.

## ADR-0022: Reporting exports are synchronous CSV; suppression applies only to re-identifying breakdowns

**Date:** 2026-08-18
**Status:** Accepted
**Deciders:** Project operator

**Context**
`PRD.md` §11.8/§17 specifies `POST /exports` as an asynchronous job: request queued via SQS, delivered as a presigned S3 link once a worker finishes, CSV or PDF. Building it forced a look at what infrastructure actually exists for that path, and the answer was none: no S3 presign helper anywhere in the codebase, no exports queue in `infra/src/stacks/messaging-stack.ts`, nothing deployed to real AWS at all (`documentation/decisions.md`'s own entries confirm this repeatedly), and not even a LocalStack bootstrap script for the notification queue that already exists in working code today (the SLA feature's local sweep hits `QueueDoesNotExist` against the compose LocalStack). Building the real pipeline first would mean writing that bootstrap script, a presign helper with no other caller yet, and a queue consumer for a job type nothing else produces, all before the reporting feature itself could be exercised end to end.

Separately, `PRD.md` §17.2's "suppress groups smaller than five to prevent re-identification" names no specific rows. The aggregation queries this feature adds (`packages/db/src/repositories/reports.ts`, the first aggregation-heavy repository in the codebase) produce several kinds of grouped output: volume by process and period, approver load by individual, rejection counts by step, and step duration samples by step. Not all of them carry the same re-identification risk.

**Decision**
`POST /exports` streams a CSV directly in the HTTP response (`Content-Disposition: attachment`), capped at 5,000 rows, with no queue, no S3, no PDF, and no `GET /exports/:id` polling endpoint. This is the same "local substitute now, real infra later" pattern already used for the SLA sweep standing in for EventBridge Scheduler and the dummy SES/SNS senders standing in for real delivery: the swap, when AWS is actually deployed, replaces how the export is delivered, not what it contains. The export's columns (reference, title, status, current step, submitted at, completed at) deliberately exclude submitter identity and form values, since both may carry personal data (`PRD.md` §18's `containsPersonalData` exclusion) and this synchronous path has no redaction pass; that belongs to the real async export once it exists, not reinvented here.

Suppress-below-five (`HAVING count(*) >= 5` inside the SQL itself, never a post-hoc filter after rows leave Postgres) applies to approver-load rows, rejection-reasons-by-step counts, and per-step duration samples: each is a small-population breakdown that could let a viewer infer something about an identifiable individual. It does not apply to volume-by-process-by-period buckets or the overview's org-wide completion rate and turnaround: a plain case count carries no comment, duration or decision attributable to one person, and `PRD.md` §17.1 treats volume as an always-shown top-line chart rather than a breakdown.

`GET /reports/approver-load` is gated to `admin`/`owner` (`isAdministrator`, reused verbatim from `apps/api/src/cases/permissions.ts`) rather than the broader `processOwner`/`admin`/`owner` set the other three report routes use (`canViewReports`, new in the same file), since it is the one individual-level view `PRD.md` §17.2 singles out for tighter gating. It is the one report route that legitimately returns `403` rather than `404`: the route itself is not tenant-secret, only the individual-level data behind it is role-gated, matching how `canActOnTask` already returns `403` for actionability once visibility (ADR-0015) has already been granted.

**Consequences**
Reporting ships and is exercisable end to end now, rather than blocked on infrastructure this codebase has not built for anything else yet. The cost is real and is the thing to remember: an export larger than 5,000 rows is silently truncated rather than paginated, there is no PDF option, and nothing in this path is suitable once export volume or delivery latency actually matters. The follow-up (a real SQS-backed export queue, an S3 presign helper, a PDF renderer, and the LocalStack bootstrap script this repository has needed since the SLA feature) is a named, scoped piece of future work, not a silent gap.

Suppression living inside the SQL `HAVING` clause, rather than as a filter the route or the web layer must remember to apply, means a suppressed row is data Postgres never returns: there is no future code path, refactor, or direct repository call from a script that can leak it by forgetting to filter afterwards.

**Alternatives rejected**

- **Build the real async export pipeline now.** Would match `PRD.md` literally and give the codebase its first real S3 integration. Rejected because it requires provisioning infrastructure (a queue, a bootstrap script, a presign helper) that nothing else in the codebase has needed yet, none of it exercisable without a LocalStack setup step this repository has been missing since the SLA feature, for a feature whose acceptance criteria (`docs/PRD.md` Phase 8) do not require async delivery specifically.
- **Suppress every grouped number, including volume.** More conservative reading of §17.2. Rejected because a process with genuinely low volume, itself a useful signal to a process owner, would simply vanish from the chart, and a plain count carries no individual-attributable content the way a comment, duration or decision does.
- **Gate all four report routes at the same `processOwner`/`admin`/`owner` level.** Simpler, one permission check. Rejected because `PRD.md` §17.2 explicitly separates aggregate reporting from individual-level views, and collapsing that distinction for approver load specifically undermines the "not a staff monitoring tool" purpose-limitation `GOV-STANDARDS.md` §7 states directly.

## ADR-0023: Turbopack for the development server only, with its CSS divergence recorded

**Date:** 2026-08-24
**Status:** Accepted
**Deciders:** Project operator (reported the application felt slow to move between sections)

**Context**
`apps/web` ran a plain `next dev`, which is webpack. In a Turborepo workspace with `transpilePackages: ['@orgflow/ui']`, that bundler recompiles a route's module graph on first visit and re-does much of the work as the developer moves around, so switching between sections took seconds every time rather than only once. Measured against the running server, a warm route took roughly half a second while a cold one took several, and the cold path was being hit far more often than it should have been.

Next 15.5 ships a stable Turbopack development server, so this is a flag on an existing dependency rather than a new tool: `TECH-STACK.md`'s stack is untouched and no package was added.

**Decision**
`apps/web`'s `dev` script becomes `next dev --turbopack`. `build` stays on webpack, unchanged.

The consequence that matters, and the reason this is recorded rather than left as a one-word script edit: Turbopack's CSS pipeline rewrites every `oklch()` into a fallback chain, so the development server ships

    --background: #000
    --background: color(display-p3 0 0 0)
    --background: lab(0% 0 0)

where the production build still ships `oklch(0% 0 0)`. Checked rather than assumed: the built stylesheet holds 168 `oklch()` and zero `lab()`, and the Turbopack-served one holds 172 `lab()` and zero `oklch()`. The colours are equivalent, so ADR-0017's and ADR-0020's verified contrast ratios still hold, and `packages/ui/src/tokens.test.ts` is unaffected because it parses `tokens.css` at source rather than anything a bundler emitted.

**Consequences**
Moving between sections is fast after a route's first compile, which is the whole point.

Development and production now serve different CSS text for the same palette. Nothing renders differently, but a test that asserts on a serialised colour string passes against one and fails against the other. That is not hypothetical: the five theme specs that assert `oklch(0 0 0)` fail when Playwright reuses a Turbopack development server. They do not fail in CI, because `apps/web/playwright.config.ts` runs `pnpm run start` there, against a real build. That file's own comment already said the trustworthy run is the one against a build; this makes it true of colour assertions specifically, not only of the stale-stylesheet problem it was written for.

The practical rule this sets: a local end-to-end run that is meant to be believed goes against `next build` plus `next start`, not against the development server. Running the suite against the development server found sixteen failures where the same suite against a build found one, and fifteen of those were artefacts.

**Alternatives rejected**

- **Leave the development server on webpack.** Rejected: the slowness was the reported problem, and it is real rather than a matter of taste.
- **Move the production build to Turbopack as well, so the two match.** Not rejected on merit, deferred deliberately. It would remove the divergence, but changing how the deployed artefact is built is a materially larger decision than changing how a developer runs the app locally, and `CLAUDE.md` §8 puts it in a different risk class. Worth revisiting as its own piece of work rather than as a side effect of a speed fix.
- **Rewrite the theme specs to compare parsed colours instead of serialised strings, so they pass under both.** Rejected for now: the assertions exist because ADR-0021 wanted a drift back to a lifted grey to fail a test, and loosening them to accommodate a development-only bundler difference weakens that guard to fix something CI never sees.

## ADR-0024: Member removal is a status change, and an organisation always keeps one active owner

**Date:** 2026-08-24
**Status:** Accepted
**Deciders:** Project operator (in absence; flagged for review on return)

**Context**
`PRD.md` §11.2 lists `DELETE /members/:userId` as "Remove member" and `PATCH /members/:userId` as "Update roles, department, line manager". §12.2 gives "manage members" to `admin` and `owner` and to nobody below them. Building those two endpoints forced three questions the specification does not answer, each of which is an authorisation or data-retention decision rather than a detail.

What "remove" means physically. `cases.submitted_by_user_id`, `case_tasks.assignee_user_id`, `case_transitions.actor_user_id` and every `audit_events` row reference a user permanently, and `PRD.md` §2's own check constraint on `organisation_members.status` already admits `'removed'` alongside `'active'` and `'suspended'`.

What stops an organisation being stranded. Nothing outside the product can grant the `owner` role back. An administrator who demotes or removes the last owner therefore locks every remaining member out of organisation settings, with no in-product recovery and no support tooling to appeal to.

Whether an administrator may edit their own membership. Self-demotion is not wrong in principle, but it is indistinguishable from the mistake of demoting yourself out of the screen you are standing in.

**Decision**
Removal writes `status = 'removed'`. No row is deleted. `GET /members` can filter by status, so a removed member is still listable and still resolves to a name wherever history refers to them.

An organisation must always retain at least one member who is both `active` and holds `owner`. `countActiveOwnersForCurrentTenant` lives in `packages/db` and the guard reads it inside the same transaction as the write it protects, so the count cannot move between the check and the update. A change that would take the count to zero is refused with `409`, not `403`: the caller has the right to manage members, and the request is refused because of the organisation's state rather than the caller's permissions.

An administrator may not change their own roles, and may not remove themselves. Both refuse with `403`. Every other field on their own membership stays editable, so this restricts the two operations that can lock somebody out rather than making self-service editing impossible.

The endpoints refuse a caller without `admin` or `owner` with `403` rather than `404`. `/members` is not itself a tenant secret, only the directory behind it is role-gated, which is how `GET /reports/approver-load` already answers under ADR-0022. Cross-tenant access keeps `404`, per §11.10 and ADR-0015: Row-Level Security makes another organisation's membership invisible, so the update matches no row and "not yours" is indistinguishable from "does not exist".

**Consequences**
The audit trail stays complete through a departure, which is the property that matters most here: a case decided by somebody who has since left still names them.

A removed member's row keeps occupying the `UNIQUE (organisation_id, user_id)` constraint, so re-admitting somebody is a status change back to `active` rather than a fresh insert. That is the correct shape (their history rejoins them) but it means an invitation flow, which Phase 9 has not built yet, must look for an existing row before creating one rather than assuming a new membership.

The last-owner guard costs one `count(*)` on every role or status change that touches an active owner, and nothing at all on any other update, since the guard returns before counting when the target is not an active owner.

Refusing self-role-edits means an owner who is the only administrator cannot hand their own role away in one step; they grant `admin` or `owner` to somebody else first, and that person performs the change. That is one extra step in exchange for making the lockout unreachable.

**Alternatives rejected**

- **Hard `DELETE` on the membership row.** Rejected: it either violates the foreign keys that cases, tasks, transitions and audit rows hold, or it cascades and destroys exactly the evidence `GOV-STANDARDS.md` requires the audit trail to preserve. The schema's own `'removed'` status shows this was already the intended shape.
- **Delete the membership but keep the `users` row.** Rejected: `organisation_members` is where roles, department and line manager live, so dropping it loses the answer to "what was this person's department when they submitted that case", which the engine's own `$submitter.department` condition depends on.
- **No last-owner guard, on the grounds that an administrator should be trusted.** Rejected: the failure is unrecoverable from inside the product, and trust is not the issue. The same administrator who is trusted is also the one who can make the mistake at three in the morning.
- **Enforce the guard in the web client only.** Rejected outright: the API is the boundary, and `PRD.md` §12.3 already states client-side checks are presentation only.
- **Refuse the last-owner change with `403`.** Rejected: the caller does hold the permission, and reporting it as a permissions failure sends whoever hits it to check their own roles rather than to grant the role to somebody else, which is the actual remedy. `409` says the request conflicts with the organisation's current state, which is what is true.

## ADR-0025: Invitations send email directly from the API, and acceptance is a general session's other route into an organisation

**Date:** 2026-08-25
**Status:** Accepted
**Deciders:** Project operator (asked directly on the notification-pipeline question; the rest decided and flagged for review)

**Context**
`PRD.md` §11.2 lists the four invitation endpoints as a row in the API table and nothing more: `POST /invitations`, `GET /invitations`, `DELETE /invitations/:id`, `POST /invitations/:token/accept`. Building them surfaced three questions the table does not answer, each expensive to reverse.

First, delivery. `member.invited` (§10) is documented as firing when an invitation is sent, and the event catalogue names it, but the existing notification pipeline (ADR-0016) claims a row in `notifications`, whose `recipient_user_id` is `NOT NULL` referencing `users`. An invited person has no `users` row until they accept: there is nothing for that column to reference. The general-purpose, queued, idempotent pipeline built for case and task notifications cannot deliver this one as it stands.

Second, identity. Every other tenant-scoped route in this codebase assumes a session already carries an organisation (`requireSession` 403s otherwise). Accepting an invitation is necessarily the moment a session that does not yet belong to this organisation, or belongs to none at all, is given one. `PRD.md` §12.1 step 7 already produces exactly this shape: a session with `organisationId: null` when sign-in resolves to zero or several memberships. Nothing before this feature made that session state useful for anything.

Third, the screen. `PRD.md` §13.1 lists `/invitations/:token` as a route, but the API table in §11.2 lists only its accept, not a way to read the invitation first. A screen cannot render an organisation's name, an inviter's name, or an expiry before asking somebody to commit to signing in.

**Decision**
Delivery: `POST /invitations` sends the email synchronously, in the request, using an `EmailSender` extracted to a new package, `packages/email` (the interface, its dummy, and its SES implementation, moved out of `workers/src/email`). `workers` and `apps/api` both depend on it and cannot diverge on which transport is constructed, matching ADR-0008's 3pservice pattern. The row is committed before the send is attempted, and a delivery failure is logged rather than turning a genuinely created invitation into an error response, the same reasoning `cases.ts`'s `publishOrLog` already applies to domain events. The raw invitation link is also returned in the response body, since it is the only place the raw token is ever available: the database holds only its SHA-256, by the same reasoning a session secret is never stored in the clear.

Identity: a new middleware, `requireUserSession`, sits beside `requireSession` and admits a session with `organisationId: null`. It gates only `POST /invitations/:token/accept`. Accepting checks the signed-in user's verified email against the invitation's, case-insensitively, then creates or reactivates the membership and reissues the session with the new organisation and roles, exactly ADR-0010's rotation-on-privilege-change applied to the other event that changes what a session may do.

The screen: `GET /invitations/:token` is added, unauthenticated, returning a narrower `InvitationPreview` (organisation and inviter name, email, roles, expiry, and a derived status) rather than the full `Invitation`, since it is reachable by anybody holding the link before they have proven anything.

**Consequences**
A delivery failure is now something an administrator only learns about from the returned link and this codebase's logs, not from a retry: there is no queue behind it, no idempotency key, no second attempt if SES is briefly unavailable. That is a real gap against the case and task notification pipeline's guarantees, accepted because a general recipient-less notification concept was judged a bigger, riskier change to a shared, idempotency-critical table (ADR-0016) than this feature needed to force.

`requireUserSession` is a second, narrower session gate that every future route has to choose correctly between. It exists for exactly one endpoint today; a second null-organisation use case (`/auth/switch-organisation`, still unbuilt) would be the point to confirm the shape still fits rather than growing a third gate beside it.

The invitation email is not appended to `member.invited`. The event still fires, for anything downstream (an audit view, a future in-app notification) that only needs to know an invitation happened, not how the email was delivered.

**Alternatives rejected**

- **Extend `notifications` with a nullable `recipient_email` alongside `recipient_user_id`.** Would keep one delivery pipeline for everything. Rejected: a schema change to a shared, idempotency-critical table, for one feature, when the direct-send path needed no queue, no redelivery and no claim semantics that table exists to provide (accepting is itself the domain-level idempotency: a token accepted twice is refused by its own status, not by the notification layer).
- **Duplicate the email sender inside `apps/api` rather than extracting a package.** Rejected: two SES implementations to keep in step, for a transport the dependency direction already had a slot for (`db`, `documents` and `events` are the same shape: a package below `api`/`workers`, depended on by both).
- **A dedicated `/organisations/select` or reuse of the unbuilt `/auth/switch-organisation` for acceptance.** Considered, since both would also turn a null-organisation session into a real one. Rejected for this feature: switching to an organisation you already belong to and joining one via a token are different operations with different authorisation questions (membership already exists versus is about to be created), and conflating them would make the unbuilt switch endpoint carry invitation semantics it does not need.
- **Leave `GET /invitations/:token` out and require sign-in before showing anything.** Rejected: sending somebody through OIDC before they know which organisation, or whose invitation, they are accepting is a worse experience for no security benefit, since the token itself is already the secret; naming what it unlocks is not a further disclosure.

## ADR-0026: Organisation creation is gated to a global platform admin flag, not open self-serve

**Date:** 2026-08-25
**Status:** Accepted
**Deciders:** Project operator (discussed directly, using DWP Digital as a concrete worked example)

**Context**
`PRD-SUMMARY.md` §3 lists "self-serve creation" as an in-scope bullet, and names a "Platform admin, the OrgFlow operator" as a user type in its role table. Neither was ever carried into `PRD.md`'s concrete specification: no schema column, no entry in the `organisation_members.roles` enum, no API gate, no screen design. `POST /organisations` did not exist as a route at all; the only organisation that has ever existed locally is the one the dev-seed script inserts directly into Postgres, bypassing the API entirely. `createOrganisation` in `packages/db` was fully built and exercised by every integration test fixture, with nothing calling it in production code.

Discussing a concrete worked example (DWP Digital as one organisation, with internal arms such as IT and Finance) surfaced the actual question: should any signed-in identity be able to create a new tenant, the way a public SaaS sign-up flow works, or should that require a role that sits above every organisation, the way an internal platform typically provisions tenants for a real institution's sub-units.

**Decision**
Organisation creation requires `users.is_platform_admin`, a new boolean column with a default of `false`. This is the one deliberate exception to "every table carries `organisation_id` and is scoped by it": `users` already carries no `organisation_id` and has no RLS policy (`PRD.md` §2.1), so a genuinely global flag on it is consistent with how that table already behaves, not a new kind of exception introduced for this feature alone. It cannot live in `organisation_members.roles`, because every value there means something only relative to one organisation; "platform admin" is not scoped to any organisation by definition.

`POST /organisations` sits behind `requireUserSession` (ADR-0025's organisation-optional session gate), checks the flag, and refuses with `403` otherwise: the route itself is not a tenant secret (there is no tenant yet), so there is nothing to disclose by refusing plainly, unlike the `404`-for-cross-tenant reasoning in `PRD.md` §11.10. The creating platform admin becomes the new organisation's first `owner`, the same shape `dev-seed.ts` already uses for the seeded local identity, and the session is reissued with the new organisation and roles, ADR-0010's rotation-on-privilege-change applied to the other event that gives a session its first organisation. `ensurePlatformAdmin` grants the seeded local dev user (`dev@orgflow.local`) the flag, so it is the "entire superadmin" stand-in the operator described, and the route is exercisable locally without a manual `UPDATE`.

There is no grant or revoke API in this decision. Becoming a platform admin is a manual database operation. Deliberately deferred rather than solved now, since nothing in this codebase yet needs a second platform admin, and inventing a grant flow for a population of one is the kind of speculative scope `CLAUDE.md` already argues against.

`GET`/`PATCH /organisations/current` were built in the same slice, since they are the other half of the same missing route file and `PRD.md` §11.2 already specifies their shape plainly (branding, settings, name). `PATCH` is gated to the `owner` role specifically, not `admin`, matching `PRD.md` §12.2's own distinction: `admin` gets "manage members, groups, IdP, retention," `owner` gets "manage organisation settings" as the one thing above that. Neither endpoint is part of the platform-admin decision; they are ordinary per-organisation authorisation, unchanged in kind from every other route already gated this way.

**Consequences**
A brand-new signed-in identity with zero organisations and no invitation waiting has no path forward today beyond asking a platform admin to either create an organisation for them or invite them into an existing one. That is a real, accepted gap: `PRD.md` specifies no "request access" flow, and inventing one was not part of this decision. It is the direct cost of choosing the gated model over self-serve.

The slug used in the organisation's URL and uniqueness constraint is derived from the name (lower-cased, hyphenated) rather than chosen separately, so two organisations with names that collide once slugified refuse with `409` at creation, surfaced the same way `invitations.ts` already turns its own unique-index conflict into a clean response rather than a raw constraint error.

Every future route that needs a platform-wide (not organisation-wide) authorisation check now has a real, precedented place to read that from, rather than each one inventing its own ad hoc global-admin concept.

**Alternatives rejected**

- **Open self-serve, as `PRD-SUMMARY.md`'s bullet literally states.** Rejected on discussion: this product models internal organisational tooling (`GOV-STANDARDS.md`'s framing throughout), not a public sign-up SaaS, and letting any authenticated email spin up a new tenant is a poor fit for that. The DWP worked example was the concrete case that made this legible.
- **A special "platform" organisation whose members are platform admins**, reusing the existing role/membership machinery instead of a new column. Rejected: it stretches "organisation" to mean two different things in the same schema (a real tenant, and a bag of platform-level permissions), and every place that already reasons about "the current organisation" would need to specifically exclude this one, which is exactly the kind of implicit special case the flat, uniform tenant model was built to avoid.
- **A grant/revoke API for the flag, built now.** Considered, not built: nothing in this codebase yet needs a second platform admin, and the manual path is trivially reversible if that changes, unlike the schema or route design itself.
- **Nested/child organisations**, so DWP Digital's internal arms could be their own tenants under a shared parent. Rejected on discussion: the operator confirmed "different templates, same organisation" is the actual ceiling for this use case, and nested tenancy is a substantially larger schema and authorisation-model change than anything this decision needed. `ADR-0027` gives IT and Finance what they actually asked for, group-scoped template ownership, without it.
