import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn, signInAsManager } from './support';

test.describe('organisation creation', () => {
  test('prompts sign-in when nobody is signed in', async ({ page }) => {
    await page.goto('/organisations/new');

    await expect(page.getByRole('heading', { name: 'Sign in first', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test('refuses a signed-in user who is not a platform admin', async ({ page }) => {
    // The seeded manager (ADR-0002's dev-login path) has no platform-admin
    // flag, unlike the seeded dev user (ADR-0026's ensurePlatformAdmin).
    await signInAsManager(page);
    await page.goto('/organisations/new');

    await expect(
      page.getByRole('heading', { name: 'Platform admin access required', level: 1 }),
    ).toBeVisible();
    await expect(page.getByLabel('Organisation name')).toHaveCount(0);

    await expectNoAccessibilityViolations(page);
  });

  test('lets a platform admin create an organisation and lands in it', async ({ page }) => {
    await signIn(page);
    await page.goto('/organisations/new');

    await expect(
      page.getByRole('heading', { name: 'Create an organisation', level: 1 }),
    ).toBeVisible();
    await expectNoAccessibilityViolations(page);

    const name = `E2E Org ${Date.now()}`;
    await page.getByLabel('Organisation name').fill(name);
    await page.getByRole('button', { name: 'Create organisation' }).click();

    // ADR-0026: creation reissues the session with the new organisation
    // active, so this lands straight on its dashboard rather than a
    // further organisation-selection step.
    await page.waitForURL('/');
    await expect(page.getByRole('button', { name: /Account:/ })).toBeVisible();

    // The creator became this organisation's owner (ADR-0026), so the
    // members directory reaches them, still within the new organisation.
    await page.goto('/settings/members/directory');
    await expect(page.getByRole('row').filter({ hasText: '(you)' })).toContainText('Owner');
  });
});
