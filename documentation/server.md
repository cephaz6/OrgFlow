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

*No server code has been written yet. Phase 0 is in progress; the first entry will record the monorepo scaffold and `packages/types`.*
