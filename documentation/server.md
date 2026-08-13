# Server log

An append-only running log of everything built in `apps/api`, `packages/core`, `packages/db`, `packages/documents`, `packages/events`, `workers/` and `infra/`.

**Read this before writing server code.** It holds the current state of the back end: the schema as it stands, the endpoints that exist, the AWS resources provisioned, and the patterns already settled. Skipping it means re-deciding questions that are closed.

## Rules

- **Append only.** Never edit or delete an existing entry. If something is superseded, write a new entry saying so.
- **Same commit as the change.** An entry written retrospectively is worth very little, because the reasoning has already been lost.
- **Newest entries at the bottom**, so the file reads chronologically.
- **No em-dashes**, per `CLAUDE.md` §5.1.

## When to append

- A module, service or worker is added or significantly changed
- A dependency is added or removed
- A Postgres migration runs, or a Mongo document shape changes
- An API endpoint is added, changed or removed
- An AWS resource is introduced or reconfigured
- A domain event is added to the catalogue
- A pattern or convention is established, for example repository scoping or transaction boundaries
- A bug with a non-obvious cause is fixed

Schema and API entries carry extra weight. Record the migration filename, and state explicitly whether the change is backward compatible.

## Entry format

One line per entry. No sections, no headers. Entries below this point predate the switch to
this format; do not rewrite them, per the append-only rule above.

```markdown
- YYYY-MM-DD [Type] area/path: one-sentence summary of what changed and why. (ADR-000X if applicable.)
```

`Type` is one of Feature, Change, Fix, Dependency, Schema, Infrastructure.

---

## Entries

## 2026-08-13: Configuration convention established

**Type:** Change
**Area:** repository root

**What changed**
Replaced the README's inline table of environment variables and example values with `.env.example` as the single source of truth, plus a short Configuration section explaining the convention. Added a rule to `CLAUDE.md` §3 that `process.env` is read only inside an application's config module.

**Why**
The original README exposed a Postgres connection string with credentials and enumerated every variable with a concrete value. Even for local-only values, that is the wrong pattern to establish in the most-read file in the repository, and it duplicates `.env.example`.

**Notes**

- Full rationale recorded as ADR-0001 in `documentation/decisions.md`.
- The convention: validate the whole environment once at boot against a Zod schema, export a typed frozen object, read `process.env` nowhere else. No code exists yet to enforce this; the ESLint rule is Phase 0 scope.
- `.env.example` may hold the credentials of local Docker Compose containers, since they are ephemeral and bound to localhost, but never a genuine secret.
- Deployed environments do not use `.env`; configuration comes from AWS Secrets Manager and Parameter Store.

**Follow-ups**

- Write the actual config module and the ESLint rule restricting `process.env` access, in the Phase 0 toolchain increment.

## 2026-08-13: Monorepo scaffold and tooling

**Type:** Infrastructure
**Area:** repository root, apps/_, packages/_, workers, infra

**What changed**
Scaffolded the Phase 0 monorepo: pnpm workspaces plus Turborepo, base TypeScript config, ESLint flat config with `typescript-eslint`, Prettier, Husky pre-commit and commit-msg hooks, commitlint, Changesets, and a GitHub Actions CI workflow running lint, typecheck, test and build on every push and pull request. Every workspace package named in `TECH-STACK.md` §2 (`apps/web`, `apps/api`, `packages/types`, `packages/core`, `packages/db`, `packages/documents`, `packages/events`, `packages/ui`, `workers`, `infra`) now exists as a placeholder package: its own `package.json`, a `tsconfig.json` extending the root `tsconfig.base.json`, and a minimal `src/index.ts`, so the pipeline is real rather than aspirational.

**Why**
Phase 0 build order, step 1: the tooling and workspace layout everything else builds on, per `CLAUDE.md` §9 and the `buildnow`-derived Phase 0 plan.

**Notes**

- The package manager is **pnpm**, not the npm workspaces originally pinned in `TECH-STACK.md` §1. Recorded as ADR-0006. `TECH-STACK.md`, `CLAUDE.md` §9 and the `pnpm dev` references in `PRD.md`/`PRD-SUMMARY.md` were updated in this same commit.
- No package has real logic yet beyond an empty `export {};`, and no cross-package imports exist, so the dependency-direction ESLint rule and the `process.env` boundary rule from ADR-0001 are deliberately deferred to the next step, once `packages/types` gives them something to enforce against.
- Each package's `lint`/`typecheck`/`test`/`build` scripts invoke `eslint`, `tsc` and `vitest` directly rather than each declaring its own copy; these resolve via the root workspace's hoisted `node_modules/.bin`, which is the standard pnpm-workspace pattern for shared dev tooling versions.
- `lint`, `typecheck`, `test` and `build` all pass cleanly across all ten packages, confirmed both cold and Turborepo-cached.

**Follow-ups**

- `packages/types`: shared domain contracts (Phase 0 build order, step 2).
- Dependency-direction and `process.env`-boundary ESLint rules (step 3).
- Real content for `packages/db`, `apps/api`, the OIDC auth shell, `apps/web`, the Testcontainers/security-scan CI jobs, and the CDK skeleton follow in the remaining Phase 0 steps.

## 2026-08-13: `.env.example` stripped of values

**Type:** Change
**Area:** repository root

**What changed**
`.env.example` now lists every `ORGFLOW_`/`NEXT_PUBLIC_` variable name and its explanatory comment with the value left blank, carrying no values at all rather than the previous mix of harmless local defaults alongside blank secrets. The actual local development values (Docker Compose connection strings, ports, LocalStack endpoint) now live only in a real `.env` at the repository root, which was never committed.

**Why**
With AWS Secrets Manager integration planned for a later phase, the operator chose to tighten the convention now rather than let committed-but-harmless values normalise the habit of putting values into a tracked file.

**Notes**

- Recorded as ADR-0007, which supersedes the values policy (not the overall structure) of ADR-0001.
- Genuine secrets (`ORGFLOW_SESSION_SECRET`, `ORGFLOW_OIDC_CLIENT_SECRET`) remain blank in both files, as before.

**Follow-ups**

- Fill in `ORGFLOW_OIDC_*` and `ORGFLOW_EVENTS_TOPIC_ARN` in local `.env` once those are provisioned (Phase 0 step 7, Phase 1 respectively).
