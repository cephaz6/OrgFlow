import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

test.describe('breadcrumbs', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('the dashboard itself carries no breadcrumb trail', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toHaveCount(0);
  });

  test('a top-level page in the sidebar shows a one-step trail back to the dashboard', async ({
    page,
  }) => {
    await page.goto('/catalogue');

    const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(trail).toBeVisible();
    await expect(trail.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/');
    await expect(trail.getByText('Catalogue', { exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('a page reachable only from the bell icon, not the sidebar, still shows its trail', async ({
    page,
  }) => {
    await page.goto('/notifications');

    const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(trail.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(trail.getByText('Notifications', { exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('a case detail page, reached only through My requests, carries the full trail and can navigate up it', async ({
    page,
  }) => {
    await page.goto('/cases/new/laptop-request');
    await page.getByLabel(/Which model do you need/).selectOption('mbp14');
    await page.getByLabel(/Estimated cost/).fill('640');
    await page
      .getByLabel(/Why do you need this/)
      .fill('The current machine no longer builds the project within a working day.');
    await page.getByLabel(/When do you need it by/).fill('2026-12-01');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await page.getByRole('link', { name: 'Track this request' }).click();

    const trail = page.getByRole('navigation', { name: 'Breadcrumb' });
    await expect(trail.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(trail.getByRole('link', { name: 'My requests' })).toBeVisible();

    await trail.getByRole('link', { name: 'My requests' }).click();
    await expect(page.getByRole('heading', { name: 'My requests', level: 1 })).toBeVisible();
  });

  test('has no accessibility violations with a breadcrumb trail on the page', async ({ page }) => {
    await page.goto('/catalogue');
    await expectNoAccessibilityViolations(page);
  });
});
