import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

test.describe('subject access export', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('is reachable from a member row in the directory', async ({ page }) => {
    await page.goto('/settings/members/directory');

    const row = page
      .getByRole('table', {
        name: 'Members of this organisation, their roles and their line manager',
      })
      .getByRole('row')
      .filter({ hasText: 'manager@orgflow.local' });
    await row.getByRole('link', { name: /Export data/ }).click();

    await expect(page).toHaveURL(/\/settings\/data-protection\?userId=/);
    await expect(
      page.getByRole('heading', { name: /^Subject access export: /, level: 1 }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Membership' })).toBeVisible();
  });

  test('prompts to pick a member when no userId is given', async ({ page }) => {
    await page.goto('/settings/data-protection');

    await expect(page.getByText('No member selected')).toBeVisible();
    await page.getByRole('link', { name: 'Go to active members' }).click();
    await expect(page).toHaveURL(/\/settings\/members\/directory$/);
  });

  test('offers a download of the export as JSON', async ({ page }) => {
    await page.goto('/settings/members/directory');
    const row = page
      .getByRole('table', {
        name: 'Members of this organisation, their roles and their line manager',
      })
      .getByRole('row')
      .filter({ hasText: 'manager@orgflow.local' });
    await row.getByRole('link', { name: /Export data/ }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download JSON' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^subject-export-.+\.json$/);
  });

  test('has no accessibility violations', async ({ page }) => {
    await page.goto('/settings/members/directory');
    const row = page
      .getByRole('table', {
        name: 'Members of this organisation, their roles and their line manager',
      })
      .getByRole('row')
      .filter({ hasText: 'manager@orgflow.local' });
    await row.getByRole('link', { name: /Export data/ }).click();

    await expect(page.getByRole('heading', { name: 'Membership' })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });
});
