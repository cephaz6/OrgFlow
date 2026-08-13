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
