import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

// Fills and submits the seeded Laptop Request, returning its reference.
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

test.describe('my requests', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('lists a submitted request and links to it by reference', async ({ page }) => {
    const reference = await submitLaptopRequest(page, '640');

    await page.goto('/cases');
    await expect(page.getByRole('heading', { name: 'My requests', level: 1 })).toBeVisible();

    const row = page.getByRole('row').filter({ hasText: reference });
    await expect(row).toContainText('Laptop request');
    // Status carries a text label, not only a colour (CLAUDE.md §3).
    await expect(row).toContainText('In progress');

    await expectNoAccessibilityViolations(page);
  });

  test('shows the case, its answers and its history, with no accessibility violations', async ({
    page,
  }) => {
    const reference = await submitLaptopRequest(page, '640');
    await page.getByRole('link', { name: 'Track this request' }).click();

    await expect(page.getByRole('heading', { name: reference, level: 1 })).toBeVisible();

    // Answers are labelled from the pinned document, and rendered as the
    // question asked for them: the select shows its option label, not the
    // stored code, and the currency field is formatted as money.
    await expect(page.getByText('MacBook Pro 14-inch')).toBeVisible();
    await expect(page.getByText('£640.00')).toBeVisible();

    await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
    await expect(page.getByText('Request submitted')).toBeVisible();
    // The step's name in the seeded definition, not a paraphrase: the
    // timeline reads it from the pinned document.
    await expect(page.getByText('Started at Line manager approval')).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test('confirms before cancelling, and requires a reason', async ({ page }) => {
    const reference = await submitLaptopRequest(page, '640');
    await page.getByRole('link', { name: 'Track this request' }).click();

    await page.getByRole('button', { name: 'Cancel this request' }).click();
    // PRD.md §13.2: a confirmation step for an irreversible decision, and
    // cancelling cannot be undone.
    await expect(page.getByText(/closes it for good/)).toBeVisible();

    // The API requires a reason, so the form asks for one rather than
    // letting the requester discover a 400.
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();
    await expect(page.getByText('Give a reason for cancelling this request.')).toBeVisible();

    await page
      .getByLabel(/Why are you cancelling it/)
      .fill('Ordered through the hardware refresh.');
    await page.getByRole('button', { name: 'Yes, cancel it' }).click();

    // "Cancelled" now appears in the status badge, the progress list and
    // twice in the history, so this asserts on the specific places rather
    // than on the word.
    await expect(page.getByText('Moved to Cancelled')).toBeVisible();
    await expect(page.getByText('Request cancelled')).toBeVisible();
    // The action disappears once the case is terminal: there is nothing
    // left to cancel.
    await expect(page.getByRole('button', { name: 'Cancel this request' })).toBeHidden();

    // The reason reaches the history rather than only the audit table.
    await expect(page.getByText('Ordered through the hardware refresh.')).toBeVisible();

    await page.goto('/cases');
    await expect(page.getByRole('row').filter({ hasText: reference })).toContainText('Cancelled');
  });

  test('does not offer amendment on a case that was not returned', async ({ page }) => {
    await submitLaptopRequest(page, '640');
    await page.getByRole('link', { name: 'Track this request' }).click();

    await expect(page.getByRole('link', { name: 'Amend and resubmit' })).toBeHidden();
  });

  test('redirects away from the amend form when the case is not awaiting amendment', async ({
    page,
  }) => {
    await submitLaptopRequest(page, '640');
    await page.getByRole('link', { name: 'Track this request' }).click();
    // Waits for the navigation to land before reading the id out of the
    // URL. Reading it straight after the click races the router and yields
    // the previous path.
    await page.waitForURL(/\/cases\/[0-9a-f-]{36}$/);
    const url = page.url();
    const caseId = url.slice(url.lastIndexOf('/') + 1);

    // Reaching the form directly must not present a form the API would
    // refuse with 409.
    await page.goto(`/cases/${caseId}/amend`);
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}$`));
  });
});
