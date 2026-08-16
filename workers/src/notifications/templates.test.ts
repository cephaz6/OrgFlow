import { describe, expect, it } from 'vitest';

import { buildTaskAssignedEmail, buildTaskClaimableEmail } from './templates.js';
import type { TaskNotificationFacts } from './templates.js';

function facts(overrides: Partial<TaskNotificationFacts> = {}): TaskNotificationFacts {
  return {
    reference: 'LAP-000123',
    processName: 'Laptop request',
    caseTitle: 'MacBook Pro 14-inch',
    stepName: 'Line manager approval',
    taskType: 'approval',
    requesterName: 'Priya Nair',
    dueAt: '2026-08-18T09:00:00.000Z',
    taskId: '01a008a3-1e3e-75c7-ac9e-0be1e8c853a5',
    webUrl: 'http://localhost:3000',
    ...overrides,
  };
}

describe('notification templates', () => {
  it('leads the subject with the reference and the action, per PRD.md §14.2', () => {
    const email = buildTaskAssignedEmail(facts());

    expect(email.subject).toBe('LAP-000123 Approval needed: Laptop request');
  });

  it('names the action after the task type rather than always saying approval', () => {
    expect(buildTaskAssignedEmail(facts({ taskType: 'action' })).subject).toBe(
      'LAP-000123 Action needed: Laptop request',
    );
    expect(buildTaskAssignedEmail(facts({ taskType: 'acknowledgement' })).subject).toBe(
      'LAP-000123 Acknowledgement needed: Laptop request',
    );
  });

  it('links to the actionable screen, not a landing page', () => {
    const email = buildTaskAssignedEmail(facts());
    const link = 'http://localhost:3000/approvals/01a008a3-1e3e-75c7-ac9e-0be1e8c853a5';

    expect(email.textBody).toContain(link);
    expect(email.htmlBody).toContain(`href="${link}"`);
  });

  it('does not double the slash when the web URL has a trailing one', () => {
    const email = buildTaskAssignedEmail(facts({ webUrl: 'http://localhost:3000/' }));

    expect(email.textBody).toContain('http://localhost:3000/approvals/');
    expect(email.textBody).not.toContain('3000//approvals');
  });

  it('states the deadline explicitly in UTC, and omits it when there is none', () => {
    expect(buildTaskAssignedEmail(facts()).textBody).toContain('Respond by: 2026-08-18 09:00 UTC');
    expect(buildTaskAssignedEmail(facts({ dueAt: null })).textBody).not.toContain('Respond by');
    // A malformed timestamp is dropped rather than printed as "Invalid Date".
    expect(buildTaskAssignedEmail(facts({ dueAt: 'not-a-date' })).textBody).not.toContain(
      'Respond by',
    );
  });

  it('tells a pool recipient that somebody else may take the task', () => {
    const email = buildTaskClaimableEmail(facts());

    expect(email.textBody).toContain('Claim it first');
    expect(buildTaskAssignedEmail(facts()).textBody).not.toContain('Claim it first');
  });

  it('escapes tenant-authored text in the HTML body but not the text body', () => {
    // A process name is authored by a tenant, so it reaches the HTML body as
    // untrusted input.
    const email = buildTaskAssignedEmail(
      facts({ processName: 'Laptop <script>alert(1)</script> request' }),
    );

    expect(email.htmlBody).not.toContain('<script>');
    expect(email.htmlBody).toContain('&lt;script&gt;');
    // The subject is not HTML, so it is left as written.
    expect(email.subject).toContain('<script>');
  });

  it('provides both a text and an HTML body', () => {
    const email = buildTaskAssignedEmail(facts());

    expect(email.textBody.length).toBeGreaterThan(0);
    expect(email.htmlBody.length).toBeGreaterThan(0);
    expect(email.textBody).toContain('Reference: LAP-000123');
    expect(email.htmlBody).toContain('Reference: LAP-000123');
  });
});
