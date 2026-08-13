# Client log

An append-only running log of everything built in `apps/web` and `packages/ui`.

**Read this before writing client code.** It holds the current state of the front end: what exists, what patterns are established, and what was deliberately deferred. Skipping it means rebuilding work that is already done.

## Rules

- **Append only.** Never edit or delete an existing entry. If something is superseded, write a new entry saying so.
- **Same commit as the change.** An entry written retrospectively is worth very little, because the reasoning has already been lost.
- **Newest entries at the bottom**, so the file reads chronologically.
- **No em-dashes**, per `CLAUDE.md` §5.1.

## When to append

- A feature, screen or component is added or significantly changed
- A dependency is added or removed
- An API endpoint the client consumes changes shape
- A pattern or convention is established, for example a data-fetching or form-state approach
- A design token is added or its meaning changes
- An accessibility decision is made, particularly around focus, live regions or keyboard alternatives
- A bug with a non-obvious cause is fixed

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

*No client code has been written yet. Phase 0 is in progress; the first entry will record the Next.js app shell.*
