import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

function retentionTable(page: import('@playwright/test').Page) {
  return page.getByRole('table', {
    name: 'Every process definition and how long a completed case is kept before redaction',
  });
}

test.describe('retention', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('is reachable from the navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Retention' }).click();

    await expect(page).toHaveURL(/\/settings\/data-protection\/retention$/);
    await expect(page.getByRole('heading', { name: 'Retention', level: 1 })).toBeVisible();
  });

  test('sets a retention window, persists it across a reload, then clears it back to indefinite', async ({
    page,
  }) => {
    await page.goto('/settings/data-protection/retention');

    const row = retentionTable(page).getByRole('row').filter({ hasText: 'Laptop request' });
    const input = row.getByRole('spinbutton');

    await input.fill('90');
    await row.getByRole('button', { name: /Save/ }).click();
    await expect(row.getByRole('button', { name: /Save/ })).toHaveCount(0);

    await page.reload();
    const reloadedRow = retentionTable(page).getByRole('row').filter({ hasText: 'Laptop request' });
    await expect(reloadedRow.getByRole('spinbutton')).toHaveValue('90');

    // Cleared back to indefinite, so this spec leaves the setting the way
    // it found it.
    await reloadedRow.getByRole('spinbutton').fill('');
    await reloadedRow.getByRole('button', { name: /Save/ }).click();
    await expect(reloadedRow.getByRole('button', { name: /Save/ })).toHaveCount(0);

    await page.reload();
    const finalRow = retentionTable(page).getByRole('row').filter({ hasText: 'Laptop request' });
    await expect(finalRow.getByRole('spinbutton')).toHaveValue('');
  });

  test('has no accessibility violations', async ({ page }) => {
    await page.goto('/settings/data-protection/retention');
    await expect(page.getByRole('heading', { name: 'Retention', level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });
});
