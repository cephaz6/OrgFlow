# OrgFlow: Standards and Practices

> **Purpose of this document.** OrgFlow is a multi-tenant product for any organisation, but it holds itself to UK government digital standards as its **quality bar**. This document states which standards apply, why, and what they concretely require of the build. Where a standard is mandatory only in a public-sector deployment, that is marked explicitly.
>
> **How to use this document.** Treat the checklists as acceptance criteria. A feature is not complete if it fails an item marked **MUST**.

---

## 1. Why government standards for a general product

- They are **public, specific and testable**, unlike vague notions of "good practice".
- The **accessibility bar (WCAG 2.2 AA)** is a legal requirement for UK public bodies and a strong differentiator everywhere else. Approval tooling that genuinely works with a keyboard and a screen reader is rare.
- The **audit and record-keeping expectations** in government map exactly onto OrgFlow's core value proposition.
- Building to these standards means a public-sector deployment requires **no re-architecture**, only configuration and assurance evidence.

---

## 2. Terminology: internal staff tooling vs citizen services

This distinction matters and is frequently confused. Getting it wrong leads to the wrong auth architecture.

| | Citizen-facing service | Internal staff tooling (**OrgFlow**) |
|---|---|---|
| Users | Members of the public | Employees, contractors, staff |
| Identity | **GOV.UK One Login** | **Entra ID / Okta / Google Workspace via OIDC** |
| Design system | GOV.UK Design System (mandatory) | GDS-informed; organisation-branded |
| Assessment | GDS Service Standard assessment | Internal governance / departmental assurance |
| Domain | `service.gov.uk` | Internal domain |

**GOV.UK One Login is out of scope for OrgFlow.** It is the citizen identity system. OrgFlow authenticates staff, so it integrates with corporate identity providers via generic OIDC. This is recorded here so the distinction is never re-litigated.

---

## 3. Accessibility: WCAG 2.2 Level AA

**Status: MUST. Non-negotiable, in every deployment.**

Legal basis: Public Sector Bodies (Websites and Mobile Applications) (No. 2) Accessibility Regulations 2018; Equality Act 2010 (applies to private employers as employers).

### 3.1 Why this is genuinely hard here

Two areas of OrgFlow are accessibility-critical and easy to get wrong:

1. **The dynamically rendered form runtime.** Conditional fields appearing and disappearing, client-side validation, multi-section forms, file upload states.
2. **The drag-and-drop form builder.** Drag-and-drop is the single most commonly inaccessible interaction pattern on the web.

### 3.2 Concrete requirements

**Structure and semantics**
- **MUST** use native HTML elements before ARIA. A `<button>` before a `<div role="button">`.
- **MUST** have exactly one `<h1>` per page, with a logical heading hierarchy beneath it.
- **MUST** use landmark regions (`<main>`, `<nav>`, `<header>`, `<footer>`).
- **MUST** provide a working skip link to main content.
- **MUST** set a unique, descriptive `<title>` per page, following the pattern `Page name: Process name: OrgFlow`.
- **MUST** set `lang` on the `<html>` element.

**Forms**
- **MUST** associate every input with a visible `<label>`. Placeholder text is never a label.
- **MUST** associate hint text and error messages with their input via `aria-describedby`.
- **MUST** group related radio and checkbox inputs in `<fieldset>` with a `<legend>`.
- **MUST** show an error summary at the top of the form on validation failure, listing each error as a link that moves focus to the offending field.
- **MUST** set `aria-invalid` on fields in error.
- **MUST** move focus to the error summary on failed submission.
- **MUST NOT** rely on colour alone to indicate an error state.
- **MUST** announce conditionally revealed fields. Use a live region or move focus deliberately; never reveal silently.
- **SHOULD** follow the GOV.UK "one thing per page" pattern for long or complex forms.

**Drag and drop (form builder), WCAG 2.2 SC 2.5.7 Dragging Movements**
- **MUST** provide a non-dragging alternative for every drag operation. Concretely: keyboard-operable "move up" / "move down" / "move to section" controls, plus an "add field" flow that never requires a drag.
- **MUST** announce reorder operations via an `aria-live="polite"` region ("Cost field moved to position 3 of 6").
- **SHOULD** implement full keyboard drag-and-drop (space to lift, arrows to move, space to drop, escape to cancel).

**Keyboard and focus**
- **MUST** make all functionality keyboard-operable, with no keyboard traps.
- **MUST** maintain a visible focus indicator meeting SC 2.4.11 Focus Not Obscured and SC 2.4.13 Focus Appearance (minimum 2px, 3:1 contrast).
- **MUST** ensure focus order follows visual order.
- **MUST** manage focus explicitly in modals: trap on open, return to trigger on close.

**Targets and input: WCAG 2.2 additions**
- **MUST** meet SC 2.5.8 Target Size (Minimum): 24×24 CSS pixels for interactive targets.
- **MUST** meet SC 3.2.6 Consistent Help: help/contact affordance in the same relative position on every page.
- **MUST** meet SC 3.3.7 Redundant Entry: do not ask for information already provided in the same session. Concretely, carry values across multi-step forms and never re-ask on validation failure.
- **SHOULD** meet SC 3.3.8 Accessible Authentication: no cognitive function test; allow paste into all auth fields.

**Contrast and visual design**
- **MUST** meet 4.5:1 for body text, 3:1 for large text and UI component boundaries.
- **MUST** remain usable at 400% zoom and at 320 CSS pixels wide without horizontal scrolling.
- **MUST** respect `prefers-reduced-motion`.
- **MUST NOT** convey status by colour alone. Approval states need an icon or text label alongside the colour.

**Timing and status**
- **MUST** warn before session timeout and offer extension (SC 2.2.1).
- **MUST** announce asynchronous status changes via `aria-live`: "Request submitted", "File uploaded", "Approval recorded".

### 3.3 Testing requirements

- **MUST** run `axe-core` in the Playwright E2E suite on every significant page. CI fails on any violation.
- **MUST** include `eslint-plugin-jsx-a11y` with errors, not warnings.
- **MUST** manually test the primary journeys with keyboard only.
- **SHOULD** test with NVDA (Windows/Firefox) and VoiceOver (macOS/Safari).
- **SHOULD** publish an accessibility statement. This becomes a **MUST** in a public-sector deployment, per the 2018 Regulations.

---

## 4. GDS Service Standard

**Status: informative for the product; mandatory for public-sector deployment.**

The 14 points, and what each means for OrgFlow:

| # | Point | Implication for OrgFlow |
|---|---|---|
| 1 | Understand users and their needs | Three distinct user types with different needs: requester, approver, process owner. See `PROBLEM-STATEMENT.md`. |
| 2 | Solve a whole problem for users | Cover the full path: discover process → submit → track → decide → complete → evidence. Not just the form. |
| 3 | Provide a joined-up experience | One consistent interface across every process. Notifications link back into the same place. |
| 4 | Make the service simple to use | Process owners are not engineers. If the builder needs a manual, it has failed. |
| 5 | Make sure everyone can use it | WCAG 2.2 AA (section 3), plus assisted-digital consideration. |
| 6 | Have a multidisciplinary team | N/A for a solo learning build; noted for completeness. |
| 7 | Use agile ways of working | Iterative delivery, working software each increment. |
| 8 | Iterate and improve frequently | Small, safe, frequently deployed changes. Enabled by point 12. |
| 9 | Create a secure service which protects users' privacy | Section 6. Tenant isolation is the load-bearing control. |
| 10 | Define what success looks like and publish performance data | Built-in analytics: volume, turnaround, bottlenecks, completion rate. |
| 11 | Choose the right tools and technologies | See `TECH-STACK.md`, which justifies each choice. |
| 12 | Make new source code open | Default to open; secrets never in the repo. |
| 13 | Use and contribute to open standards, common components and patterns | GOV.UK Design System swappable at theme layer; OIDC; OpenAPI. |
| 14 | Operate a reliable service | Health checks, structured logging, alerting, graceful degradation. |

---

## 5. Technology Code of Practice

**Status: informative; mandatory for UK government technology spend.**

| Point | Application to OrgFlow |
|---|---|
| Define user needs | Driven by `PROBLEM-STATEMENT.md`. |
| Make things accessible and inclusive | Section 3. |
| Be open and use open source | Open licence; open dependencies; no proprietary lock-in beyond AWS primitives. |
| Make use of open standards | OIDC, OpenAPI 3.1, JSON Schema, ISO 8601, RFC 7807 problem details. |
| Use cloud first | AWS-native, serverless-leaning. |
| Make things secure | Section 6. |
| Make privacy integral | Section 7. |
| Share, reuse and collaborate | The system template catalogue is the concrete expression of this. |
| Integrate and adapt technology | Pluggable IdP; webhook egress; documented API. |
| Make better use of data | Reporting and analytics as first-class features. |
| Define your purchasing strategy | N/A. |
| Meet the Service Standard | Section 4. |

---

## 6. Security

**Status: MUST.**

### 6.1 Tenant isolation, the primary control

This is the single most important security property of a multi-tenant product. A tenant data leak is an existential failure.

- **MUST** scope every Postgres table by `organisation_id` and every Mongo document by `organisationId`. No exceptions, including audit and lookup tables.
- **MUST** enforce scoping at the **data access layer**, not in route handlers. A repository method that can produce an unscoped query is a defect.
- **MUST** derive the tenant context from the authenticated session, **never** from a request body, query parameter or client-supplied header.
- **MUST** apply PostgreSQL Row-Level Security as defence in depth, with the tenant set per-connection via a session variable.
- **MUST** prefix every S3 object key with the organisation identifier, and enforce the prefix in IAM policy where practical.
- **MUST** include `organisationId` in every queue message envelope and re-assert it in the consumer.
- **MUST** include a dedicated cross-tenant test suite that attempts access to another tenant's resources by direct identifier and asserts `404`, never `403`, because a `403` confirms the resource exists.

### 6.2 Authentication and session management

- **MUST** use OIDC Authorization Code flow with PKCE. No implicit flow.
- **MUST** validate the ID token: signature, `iss`, `aud`, `exp`, `nonce`.
- **MUST** store sessions in `httpOnly`, `Secure`, `SameSite=Lax` cookies. No tokens in `localStorage`.
- **MUST** rotate the session identifier on privilege change.
- **MUST** enforce both absolute and idle session timeouts, with a warning before expiry.
- **MUST** support per-organisation IdP configuration, routed by verified email domain.
- **MUST** provide a seeded local development identity path that is **impossible to enable in a deployed environment**, guarded by an environment check that fails closed.

### 6.3 Authorisation

- **MUST** evaluate permissions server-side on every request. Client-side checks are presentation only.
- **MUST** scope roles per organisation, never globally.
- **MUST** verify that the acting user is the legitimate assignee (or a valid delegate) before recording any approval decision.
- **MUST** treat "can this user see this case" as a distinct check from "can this user act on this case".

### 6.4 Application security: OWASP Top 10

- **MUST** use parameterised queries exclusively. No string-concatenated SQL.
- **MUST** validate all input against a schema at the API boundary (Zod), and reject unknown fields.
- **MUST NOT** evaluate user-supplied expressions. The condition language is a declarative JSON AST interpreted by a pure function. Never `eval`, never `Function`, and never a templating engine with code execution.
- **MUST** set security headers: HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, and a Content Security Policy without `unsafe-inline` or `unsafe-eval`.
- **MUST** rate-limit authentication, submission and file upload endpoints.
- **MUST** enforce CSRF protection on state-changing requests (`SameSite` plus token).
- **MUST** validate uploads by content type sniffing, not file extension; enforce size limits; virus scan asynchronously before making a file downloadable.
- **MUST** serve files via short-lived presigned URLs, never a public bucket.
- **MUST** run `npm audit` and dependency scanning in CI, failing on high or critical severity.
- **MUST NOT** commit secrets. All secrets via AWS Secrets Manager or Parameter Store.

### 6.5 Audit logging

- **MUST** write an audit event for every state change: submission, assignment, decision, delegation, definition publication, permission change, member invitation, file access.
- **MUST** record actor, action, entity, timestamp (UTC, ISO 8601), organisation, and source IP.
- **MUST** make the audit table append-only. No `UPDATE`, no `DELETE`. Enforced by database grants, not convention.
- **MUST** write audit entries in the same transaction as the state change they describe.
- **MUST** support export in a machine-readable format for a given case or date range.
- **MUST NOT** log secrets, credentials, session tokens, or full submitted values containing special category data.

---

## 7. Data protection: UK GDPR and DPA 2018

**Status: MUST.**

- **Lawful basis.** For staff processes, typically legitimate interests or contract performance. The organisation is the controller; OrgFlow (as a deployed product) is the processor. Documented, not assumed.
- **Data minimisation.** Process owners can define arbitrary fields, so the builder **MUST** surface a warning when a field is flagged as containing personal or special category data, and **MUST** require an explicit acknowledgement.
- **Purpose limitation.** Case data is used to run the process and evidence it. Not for staff performance monitoring. Reporting **MUST** default to aggregate views; individual-level breakdowns require an explicit permission.
- **Storage limitation.** Retention policy configurable per process definition, with a scheduled job that anonymises or deletes expired cases while retaining a minimal audit skeleton.
- **Right of access and erasure.** **MUST** provide a per-subject export. Erasure requires care: the audit record of *a decision having been taken* is usually retained under legal obligation while personal content is redacted. Implement redaction, not deletion, and record the redaction as an audit event.
- **Data residency.** **MUST** make the AWS region configurable, defaulting to `eu-west-2` (London).
- **Encryption.** TLS 1.2+ in transit; AES-256 at rest across RDS, DocumentDB/Mongo, S3 and queues.
- **DPIA.** Required before a public-sector deployment. Out of scope for the build, noted for completeness.

---

## 8. Content and interaction design

Drawn from GDS content principles. These apply to OrgFlow's own interface, not to tenant-authored content.

- **MUST** write in plain English. Target reading age 9. No jargon, no Latin abbreviations, no internal acronyms unexpanded.
- **MUST** use active voice and second person: "You need to add a cost code", not "A cost code must be provided".
- **MUST** write error messages that state what went wrong *and* what to do about it. "Enter a cost code", not "Invalid input".
- **MUST** use sentence case for headings, labels and buttons.
- **MUST** label buttons with the action performed: "Submit request", "Approve", "Send back for changes". Never "OK" or "Submit".
- **MUST** format dates as `12 August 2026`, never numerically ambiguous forms.
- **MUST** display all times in the user's local timezone with the timezone indicated; store in UTC.
- **SHOULD** avoid "please", "sorry" and unnecessary politeness in interface copy; it adds reading load without adding meaning.

---

## 9. Design system

- **MUST** build UI from **shadcn/ui** primitives with all colour, spacing, typography and radius values expressed as **design tokens**, never hard-coded.
- **MUST** structure theming so a **GOV.UK Design System** theme can be applied by swapping the token set and a small number of component overrides. Concretely: no component may reference a raw hex value or a Tailwind palette colour directly.
- **SHOULD** align interaction patterns with GOV.UK equivalents where one exists: error summary, task list, check-your-answers, confirmation page. These are well-researched patterns and adopting them is free.
- **MUST** support organisation-level branding (name, logo, accent colour) without forking components.

---

## 10. Operational standards

- **MUST** emit structured JSON logs with a correlation identifier propagated across HTTP, queue and Lambda boundaries.
- **MUST NOT** log personal data at `info` level or below.
- **MUST** expose `/health` (liveness) and `/ready` (dependency checks) endpoints.
- **MUST** define and instrument service level indicators: submission success rate, API p95 latency, notification delivery rate, queue age.
- **MUST** ensure idempotency for every queue consumer, because SQS delivers at least once.
- **MUST** configure a dead letter queue for every queue, with an alarm on non-zero depth.
- **MUST** back up Postgres with point-in-time recovery; **SHOULD** test restore at least once.
- **SHOULD** implement graceful degradation. A notification outage must never block an approval decision.

---

## 11. Compliance checklist

Use as a release gate.

**Accessibility**
- [ ] `axe-core` passes on all primary pages in CI
- [ ] All journeys completable by keyboard alone
- [ ] Drag-and-drop has a tested non-drag alternative
- [ ] Error summary pattern implemented with focus management
- [ ] Usable at 400% zoom and 320px width
- [ ] Screen reader tested on submission and approval journeys
- [ ] Accessibility statement published

**Security**
- [ ] Cross-tenant access test suite passing
- [ ] Row-Level Security enabled and verified on all tenant tables
- [ ] OIDC with PKCE; dev auth path fails closed outside local
- [ ] No secrets in repository; scanning enabled
- [ ] CSP without `unsafe-inline` or `unsafe-eval`
- [ ] Uploads content-sniffed, size-limited, virus scanned
- [ ] Audit table append-only, enforced by grants
- [ ] Dependency scan clean of high and critical findings

**Data protection**
- [ ] Personal data field flagging implemented in builder
- [ ] Retention policy configurable and enforced by scheduled job
- [ ] Subject access export implemented
- [ ] Redaction implemented and itself audited
- [ ] Region configurable, defaulting to `eu-west-2`
- [ ] Encryption at rest verified across all stores

**Operational**
- [ ] Structured logging with correlation IDs across all boundaries
- [ ] Health and readiness endpoints live
- [ ] DLQs configured with alarms
- [ ] All queue consumers idempotent, with a test proving it
- [ ] Backups configured and a restore rehearsed

---

## 12. References

- GDS Service Standard: https://www.gov.uk/service-manual/service-standard
- Technology Code of Practice: https://www.gov.uk/guidance/the-technology-code-of-practice
- GOV.UK Design System: https://design-system.service.gov.uk/
- WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Understanding WCAG 2.2 new criteria: https://www.w3.org/WAI/WCAG22/Understanding/
- Public Sector Accessibility Regulations 2018: https://www.legislation.gov.uk/uksi/2018/952/made
- NCSC Secure Development Guidance: https://www.ncsc.gov.uk/collection/developers-collection
- ICO Guide to UK GDPR: https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/
- OWASP Top 10: https://owasp.org/www-project-top-ten/
