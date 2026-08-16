import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn, signInAsManager } from './support';

async function submitLaptopRequest(page: Page, cost: string): Promise<string> {
  await page.goto('/cases/new/laptop-request');
  await page.getByLabel(/Which model do you need/).selectOption('mbp14');
  await page.getByLabel(/Estimated cost/).fill(cost);
  await page
    .getByLabel(/Why do you need this/)
    .fill('The current machine no longer builds the project within a working day.');
  await page.getByLabel(/When do you need it by/).fill('2026-12-01');
  await page.getByRole('button', { name: 'Submit request' }).click();

  const reference = page.getByText(/^LAP-\d{6}$/);
  await expect(reference).toBeVisible();
  return (await reference.textContent())!;
}

// Opens the manager's decision screen for a given case reference.
async function openApproval(page: Page, reference: string) {
  await signInAsManager(page);
  await page.goto('/approvals');
  await page.getByRole('row').filter({ hasText: reference }).getByRole('link').click();
  await page.waitForURL(/\/approvals\/[0-9a-f-]{36}$/);
}

test.describe('approvals', () => {
  test('shows work assigned to the approver, most urgent first', async ({ page }) => {
    await signIn(page);
    const reference = await submitLaptopRequest(page, '640');

    await signInAsManager(page);
    await page.goto('/approvals');

    await expect(page.getByRole('heading', { name: 'Approvals', level: 1 })).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: reference });
    await expect(row).toContainText('Line manager approval');
    // PRD.md §13.2: the requester appears on every queue row.
    await expect(row).toContainText('Local Dev User');
    // Urgency is words, never a bare colour.
    await expect(row).toContainText(/Due in|Due today|Overdue|No deadline/);

    await expectNoAccessibilityViolations(page);
  });

  test('carries everything needed to decide on one screen', async ({ page }) => {
    await signIn(page);
    const reference = await submitLaptopRequest(page, '640');
    await openApproval(page, reference);

    // Requester context, which PRD.md §13.2 requires by name.
    await expect(page.getByText('Local Dev User')).toBeVisible();
    // The submitted answers, labelled from the pinned document.
    await expect(page.getByText('MacBook Pro 14-inch')).toBeVisible();
    await expect(page.getByText('£640.00')).toBeVisible();
    // The decisions this step actually allows, read from the definition.
    await expect(page.getByRole('button', { name: 'Approve' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Return for amendment' })).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test('confirms before an irreversible decision, and can be backed out of', async ({ page }) => {
    await signIn(page);
    const reference = await submitLaptopRequest(page, '640');
    await openApproval(page, reference);

    await page.getByRole('button', { name: 'Reject' }).click();
    await expect(page.getByText(/closes this request for good/)).toBeVisible();

    // Backing out must leave the request untouched, not half-decided.
    await page.getByRole('button', { name: 'Go back' }).click();
    await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
  });

  test('approves a request and moves it off the queue', async ({ page }) => {
    await signIn(page);
    const reference = await submitLaptopRequest(page, '640');
    await openApproval(page, reference);

    await page.getByLabel(/Comment/).fill('Reasonable replacement, approved.');
    await page.getByRole('button', { name: 'Approve' }).click();
    await page.getByRole('button', { name: 'Yes, approve' }).click();

    await page.waitForURL(/\/approvals$/);
    // Below the £1,000 branch threshold, so finance is skipped and the case
    // goes straight to IT: the manager's queue no longer holds it.
    await expect(page.getByRole('row').filter({ hasText: reference })).toHaveCount(0);
  });

  test('returns a request, which sends the requester back to amend it', async ({ page }) => {
    await signIn(page);
    const reference = await submitLaptopRequest(page, '640');
    await openApproval(page, reference);

    await page.getByLabel(/Comment/).fill('Please attach a supplier quote before I approve this.');
    // Returning is the one decision the requester can undo, so it goes
    // straight through without a confirmation step.
    await page.getByRole('button', { name: 'Return for amendment' }).click();
    await page.waitForURL(/\/approvals$/);

    // Back as the requester: the case must now say it is waiting on them,
    // and offer the amendment route. This is the half of the journey that
    // could not be exercised in a browser before the manager login existed.
    await signIn(page);
    await page.goto('/cases');
    const row = page.getByRole('row').filter({ hasText: reference });
    await expect(row).toContainText('Returned to you');

    await row.getByRole('link').click();
    await expect(page.getByText(/returned to you for amendment/)).toBeVisible();
    await expect(
      page.getByText('Please attach a supplier quote before I approve this.'),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Amend and resubmit' }).click();
    await expect(page.getByRole('heading', { name: `Amend ${reference}` })).toBeVisible();

    // The form arrives carrying the answers already given, not blank.
    await expect(page.getByLabel(/Estimated cost/)).toHaveValue('640');

    await expectNoAccessibilityViolations(page);

    await page.getByLabel(/Estimated cost/).fill('700');
    await page.getByRole('button', { name: 'Resubmit request' }).click();

    await page.waitForURL(/\/cases\/[0-9a-f-]{36}$/);
    // Same reference, back with the manager, and the amended value stored.
    await expect(page.getByRole('heading', { name: reference, level: 1 })).toBeVisible();
    await expect(page.getByText('£700.00')).toBeVisible();
    await expect(page.getByText('Request amended and resubmitted')).toBeVisible();
  });

  test('does not let the requester decide their own request', async ({ page }) => {
    await signIn(page);
    const reference = await submitLaptopRequest(page, '640');

    // Find the task id as the manager, then try to reach it as the
    // requester. PRD.md §12.3 keeps visibility and actionability separate:
    // the requester can see the task, and must not be able to act on it.
    await openApproval(page, reference);
    const taskUrl = page.url();

    await signIn(page);
    await page.goto(taskUrl);
    await expect(page.getByText(/not yours to decide|assigned to somebody else/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });
});
