# OrgFlow: Problem Statement

> **Purpose of this document.** This is the "why" behind OrgFlow. Every technical decision in `PRD.md` should be traceable to a problem described here. If a proposed feature does not relieve one of these pains, it is out of scope.

---

## 1. The situation

Inside almost every organisation (government department, NHS trust, university, law firm, engineering scale-up) there is a long tail of routine internal processes that are run on email, shared spreadsheets, chat threads and institutional memory.

Typical examples:

| Process | Who requests | Who approves | Typical failure |
|---|---|---|---|
| System access request | New or moving staff | Line manager → IT security | New starter has no access for two weeks |
| Equipment / laptop order | Any employee | Line manager → Finance (if over threshold) → IT | Ordered too late for project start |
| Expense approval | Any employee | Line manager → Finance | Missed reimbursement deadline |
| New starter onboarding | Hiring manager | HR → IT → Facilities → Payroll | Steps silently dropped |
| Policy exception / risk acceptance | Any team | Risk owner → Security → SIRO | No record when audited |
| Data sharing / DPIA review | Project lead | DPO → Legal → Security | Cannot evidence approval basis |
| Procurement sign-off | Budget holder | Finance → Commercial → SRO | Spend approved by wrong authority level |
| Leave of absence / secondment | Any employee | Line manager → HR | Lost in an inbox during handover |
| Change approval (CAB) | Engineering | Change manager → Service owner | Change proceeds without sign-off |

None of these processes are individually complex. All of them are broken in exactly the same way.

**The critical observation: these processes are structurally identical.** Each is a *structured form*, followed by a *conditional sequence of approvals*, producing an *auditable record*. The only difference between any two of them is the fields collected and the routing rules applied: the exact two things the process owner already knows and could specify themselves, if given somewhere to specify them.

---

## 2. From the requester's perspective

**I don't know where to start.**
There is no single place to go. I ask a colleague, who forwards a Word template someone made in 2019. I am not sure it is current. There is no index of processes, no owner listed, no guidance. I fill it in and email it to someone I am guessing is the right approver.

**I don't know what happens next.**
Once I hit send, my request disappears. No status, no reference number, no expected turnaround, no indication of how many approvals it needs or who holds them. The only signal I ever receive is the eventual outcome, or silence.

**I have to chase, and chasing is the only tracking mechanism I have.**
After a week I email again. Then I ask my manager to ask someone. I feel like a nuisance for asking about something the organisation required me to submit. The people who get their requests processed fastest are not the ones with the most urgent need; they are the ones most willing to chase.

**I get sent back to the start, late.**
Two weeks in, someone tells me I used the wrong form, missed a required field, or needed a cost code nobody mentioned. The clock resets. Nobody could have told me earlier, because nobody was looking at it until it reached the front of an inbox.

**I cannot see the rules I am being judged against.**
I do not know that spend over £1,000 needs Finance, or that contractor requests need an end date, or that anything touching personal data needs the DPO. I find out by failing.

**It becomes my delivery failure.**
A new starter sits idle for a fortnight. Equipment does not arrive before a project begins. An expense passes a claim deadline. The process failed, but the consequence lands on me and on my team's delivery.

**I have no record of my own request.**
If I need to prove I asked in good time, my evidence is a sent-items folder, assuming I still have access to it, and assuming the thread was not forwarded onward beyond my visibility.

---

## 3. From the approver's perspective

**Requests arrive with no consistent structure.**
Some are email body text. Some are attachments. Some are informal chat messages asking whether I would approve something before it is formally submitted. I have no consistent way to see what is genuinely waiting on me.

**My inbox is the queue, and it is a terrible one.**
Approvals compete for attention with everything else. A request waiting nine days looks identical to one that arrived this morning. There is no ageing, no prioritisation, no separation of "needs my decision" from "FYI". I discover urgency only when someone escalates.

**I am missing the information I need to decide.**
The request does not include the budget line, the manager's prior sign-off, the security classification, or the previous decisions on similar requests. So I email back and wait, and while I wait, the request sits with me, where from the outside it looks like I am the bottleneck.

**I don't know whether I am the right approver.**
Sometimes I approve things I probably lacked authority for. Sometimes I forward to someone who forwards it back. Nobody can point me to a definitive routing rule, so routing is done by guesswork and social convention.

**Nothing is recorded in a durable place.**
My approval is a sentence in an email. The reasoning behind it is in my head. When I leave the organisation, both disappear.

**There is no delegation and no handover.**
When I go on annual leave my pending approvals go with me. There is no way to delegate, no way for anyone else to see what is outstanding, no way to reassign. Processes stall for a fortnight because one person is on holiday.

**I cannot see my own load.**
I have no idea how many approvals I handle a month, how quickly I turn them around, or whether I am the constraint in any given process.

---

## 4. From the process owner's perspective

**I cannot answer basic questions about my own process.**
How many requests came in last month? What is the median turnaround? Which step do things get stuck at? How many were rejected and why? I would have to reconstruct all of it from other people's inboxes, and I cannot.

**I cannot change the process safely.**
When policy changes and a new approval step is required, I email everyone the new rules and hope. I have no way to enforce the change, no way to know who is still using the old form, and no way to handle requests that were already in flight when the rules changed.

**I cannot prove what happened.**
For internal audit, an FOI request, a regulator, or an inquiry, I need to show who approved what, when, and on what basis. That evidence is scattered across personal mailboxes, some of them belonging to people who have left the organisation.

**Getting it built properly is never justifiable.**
A bespoke system for a single process cannot compete with delivery priorities. So each process either stays on email indefinitely, or somebody builds a fragile spreadsheet-and-macro solution that becomes a single point of failure the moment they change team.

**Shadow systems proliferate.**
Because nothing official exists, teams build their own: a Google Form here, a Trello board there, a SharePoint list, a bot in a chat channel. Each is unmonitored, unbacked-up, unaudited and invisible to information governance.

**I own the process but not the tooling.**
I am accountable for how the process performs, while having no ability to observe, measure or change how it actually runs.

---

## 5. From the organisation's perspective

**The cost is real but invisible.**
Nobody logs the hours spent chasing, re-submitting, forwarding and reconstructing. It never appears on a budget line, so it is never addressed. Across hundreds of processes and thousands of staff, it is substantial.

**Governance is theoretical.**
Approval thresholds and authority levels exist in policy documents. Whether they are actually applied is unknown and unknowable, because there is no enforcement point and no record.

**Audit and compliance exposure.**
Under UK GDPR, records of processing and decisions affecting individuals must be demonstrable. Public bodies additionally face FOI, NAO scrutiny and public inquiry. "It was agreed in an email chain that no longer exists" is not a defensible position.

**Onboarding and offboarding leak.**
Access requests that are never revoked. Equipment never returned. Permissions that outlive the role. Each is a small failure of an unmanaged process; collectively they are a security posture.

**Institutional knowledge is personal, not organisational.**
How a process actually works lives in the heads of the two or three people who have done it most. When they leave, the process degrades, and the next person rebuilds it from scratch, slightly differently.

---

## 6. Why existing options do not solve it

**Email and spreadsheets:** the default. Zero setup cost, and every failure described above.

**Enterprise ITSM platforms (ServiceNow, Jira Service Management):** genuinely capable, but the cost and configuration burden means only the top ten or twenty processes ever get onboarded. The long tail is precisely what never justifies the effort.

**Generic form tools (Microsoft Forms, Google Forms, Typeform):** these solve collection, not routing. There is no approval chain, no conditional path, no state, no audit trail.

**Low-code platforms (Power Automate, Zapier):** flexible, but each process becomes a bespoke automation with no shared model, no consistent audit, and a maintenance burden that lands on whoever built it.

**Bespoke internal builds:** correct for the two or three highest-value processes. Uneconomic for the other ninety.

**The gap:** there is no tool that lets a *non-technical process owner* define a form and an approval chain, and have it run as a *first-class, tracked, auditable service*, without engineering involvement, and without per-process cost.

---

## 7. The underlying problem, stated plainly

> Organisations run dozens to hundreds of internal processes that share an identical structure (a structured form, a conditional sequence of approvals, and an auditable record), yet each is either rebuilt from scratch as an informal email convention or never formalised at all.
>
> The result is compounding, invisible cost: time lost to chasing and re-submission, decisions delayed for reasons nobody can observe, work blocked on administration, governance rules that exist on paper but are unenforced in practice, and no evidential record when one is required.

---

## 8. What success looks like

For OrgFlow to have solved this problem:

**For requesters**
- One place to find every process available to them.
- Rules and required information visible *before* submitting, not discovered by failing.
- A reference number, a live status, and a visible list of remaining steps.
- Zero need to chase; the system chases on their behalf.

**For approvers**
- A single queue, ordered by urgency, distinguishing "needs my decision" from everything else.
- Every piece of information needed to decide, on one screen.
- Delegation and reassignment that work, including during absence.
- No ambiguity about whether they are the correct approver.

**For process owners**
- Define and change a process without writing code or raising a ticket.
- Live metrics: volume, turnaround, bottleneck step, rejection reasons.
- Confidence that a change to the rules does not corrupt requests already in flight.
- A complete, exportable, tamper-evident audit trail on demand.

**For the organisation**
- Governance rules enforced at the point of decision rather than described in a policy document.
- Shadow systems consolidated onto one observable platform.
- Marginal cost of formalising the ninety-first process approaching zero.

---

## 9. Explicit non-goals

OrgFlow is deliberately **not**:

- A citizen-facing or customer-facing service platform. It is internal tooling. (In a UK government context, citizen-facing services belong on GOV.UK patterns with GOV.UK One Login; OrgFlow is for staff.)
- A general-purpose BPM engine with BPMN 2.0 semantics. The target user is a process owner, not a process engineer.
- A replacement for ITSM at the high-volume end. It targets the long tail those platforms never reach.
- A document management system, a project tracker, or a CRM.
- A general workflow automation tool for system-to-system integration. OrgFlow routes work to *people*.

---

## 10. Applicability beyond a single organisation

The pattern is not sector-specific. The same engine serves:

- **Government departments:** security clearance requests, information asset registration, DPIA review, procurement sign-off, change approval. High audit and accessibility obligations, described in `GOV-STANDARDS.md`.
- **Healthcare:** study approvals, equipment requests, policy exceptions, honorary contract requests.
- **Higher education:** ethics approval, research funding sign-off, fieldwork risk assessment.
- **Regulated private sector:** model risk approval, trade exception, vendor onboarding, conflict-of-interest declarations.
- **General private sector:** the same universal set of access, equipment, expenses, onboarding and leave.

Because *configuration is the product*, nothing organisation-specific lives in the codebase. A department's data-sharing approval and a start-up's laptop request are the same engine running different JSON. This is what distinguishes a platform from a tool, and it is the design constraint that governs every decision in `PRD.md`.
