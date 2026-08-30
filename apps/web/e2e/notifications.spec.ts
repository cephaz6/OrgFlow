import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn, signInAsManager } from './support';

// CI's e2e job starts only the API, not the separate workers process that
// consumes domain events and actually writes an inApp notification row
// (see .github/workflows for the job definition). Locally, `pnpm dev` runs
// both, so a real task.created event really does produce a real
// notification here; in CI it never would, through no fault of the code
// under test. The same gap attachments.spec.ts already documents for its
// own confirm-dependent tests.
const REQUIRES_WORKERS = Boolean(process.env.CI);

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

test.describe('notifications', () => {
  test('the bell is reachable from every page and links to the centre', async ({ page }) => {
    await signIn(page);
    await page.goto('/');

    await page.getByRole('link', { name: /^Notifications/ }).click();
    await expect(page).toHaveURL(/\/notifications$/);
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  });

  test('receives an in-app notification when assigned a task, and can mark it read', async ({
    page,
  }) => {
    test.skip(
      REQUIRES_WORKERS,
      'needs the workers process consuming domain events; see the note above',
    );

    await signIn(page);
    const reference = await submitLaptopRequest(page, '700');

    await signInAsManager(page);
    await page.goto('/notifications');

    const row = page.getByRole('listitem').filter({ hasText: reference });
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: /Mark as read/ })).toBeVisible();

    await row.getByRole('button', { name: /Mark as read/ }).click();
    await expect(row.getByRole('button', { name: /Mark as read/ })).toHaveCount(0);
  });

  test('has no accessibility violations', async ({ page }) => {
    await signIn(page);
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });
});
