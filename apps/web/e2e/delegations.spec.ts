import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

// Datetime-local inputs want "YYYY-MM-DDTHH:mm", no timezone suffix.
function toLocalInputValue(date: Date): string {
  return date.toISOString().slice(0, 16);
}

test.describe('delegations', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('delegates tasks to a colleague and lists it with a created date', async ({ page }) => {
    await page.goto('/settings/delegations');

    const starts = toLocalInputValue(new Date(Date.now() - 60_000));
    const ends = toLocalInputValue(new Date(Date.now() + 60 * 60_000));

    await page.getByLabel('Delegate to').fill('manager@orgflow.local');
    await page.getByLabel('Starts').fill(starts);
    await page.getByLabel('Ends').fill(ends);
    await page.getByRole('button', { name: 'Delegate my tasks' }).click();

    const entry = page.getByRole('listitem').filter({ hasText: 'Local Dev Manager' });
    await expect(entry).toBeVisible();
    // The createdAt value the API returned is actually rendered, not just
    // fetched: the "Created" line carries a real date, not a blank one.
    await expect(entry.getByText(/^Created /)).not.toBeEmpty();

    await entry.getByRole('button', { name: /Cancel/ }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Local Dev Manager' })).toHaveCount(
      0,
    );
  });

  test('finds a delegation by the colleague name, and says when a search matches nothing', async ({
    page,
  }) => {
    await page.goto('/settings/delegations');

    const starts = toLocalInputValue(new Date(Date.now() - 60_000));
    const ends = toLocalInputValue(new Date(Date.now() + 60 * 60_000));

    await page.getByLabel('Delegate to').fill('manager@orgflow.local');
    await page.getByLabel('Starts').fill(starts);
    await page.getByLabel('Ends').fill(ends);
    await page.getByRole('button', { name: 'Delegate my tasks' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Local Dev Manager' })).toBeVisible();

    const searchForm = page.getByRole('search');
    await searchForm.getByLabel(/Search your delegations/).fill('Local Dev Manager');
    await searchForm.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Local Dev Manager' })).toBeVisible();

    await searchForm.getByLabel(/Search your delegations/).fill(`no-such-colleague-${Date.now()}`);
    await searchForm.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('No delegations match this search')).toBeVisible();
    await expect(page.getByText('Clear the search to see all of your delegations.')).toBeVisible();

    // Clean up: an unfiltered view still shows the delegation to cancel it,
    // so it does not linger and affect the manager's queue in later specs.
    await page.goto('/settings/delegations');
    await page
      .getByRole('listitem')
      .filter({ hasText: 'Local Dev Manager' })
      .getByRole('button', { name: /Cancel/ })
      .click();
    await expect(page.getByRole('listitem').filter({ hasText: 'Local Dev Manager' })).toHaveCount(
      0,
    );
  });

  test('has no accessibility violations on the delegations page', async ({ page }) => {
    await page.goto('/settings/delegations');
    await expect(page.getByRole('heading', { name: 'Delegations', level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });
});
