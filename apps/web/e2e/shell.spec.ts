import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

test.describe('sign-in page', () => {
  test('has no accessibility violations', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to OrgFlow' })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  test('reaches the email field by keyboard alone, through the skip link', async ({ page }) => {
    await page.goto('/login');

    // The skip link is the first focusable element on the page (WCAG 2.4.1)
    // and must become visible when it takes focus, or it bypasses nothing
    // for a sighted keyboard user.
    await page.keyboard.press('Tab');
    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Work email')).toBeFocused();
  });
});

test.describe('application shell', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('has no accessibility violations on the dashboard', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  test('marks the current page in the navigation for assistive technology', async ({ page }) => {
    await page.goto('/');

    const navigation = page.getByRole('navigation', { name: 'Main' });
    const current = navigation.getByRole('link', { name: 'Dashboard' });

    // aria-current is the assertion, not the background colour: CLAUDE.md §3
    // forbids conveying state by colour alone, so the state has to exist
    // somewhere a screen reader can reach.
    await expect(current).toHaveAttribute('aria-current', 'page');
    await expect(navigation.getByRole('link', { name: 'Approvals' })).not.toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('opens and closes the narrow-viewport navigation by keyboard', async ({ page }) => {
    await page.setViewportSize({ width: 480, height: 900 });
    await page.goto('/');

    // The desktop column is genuinely absent here, not merely invisible,
    // so the dialog is the only way to navigate at this width.
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeHidden();

    await page.getByRole('button', { name: 'Menu' }).click();
    const dialog = page.getByRole('dialog', { name: 'Navigation' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('link', { name: 'Approvals' })).toBeVisible();

    await expectNoAccessibilityViolations(page);

    // Escape is free with a native <dialog>, and is the behaviour a
    // keyboard user expects; a hand-rolled overlay is where it goes missing.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
