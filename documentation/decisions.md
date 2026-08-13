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

*No ADRs have been recorded yet. Decisions already fixed by `TECH-STACK.md`, such as Kysely over an ORM, MongoDB for definitions, and Step Functions being out of scope, are treated as settled by that document and do not need restating here. The first ADR will record a choice made during Phase 0 that those documents do not already cover.*
