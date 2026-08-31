import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn, signInAsManager } from './support';

// Same gap notifications.spec.ts already documents: CI's e2e job starts
// only the API, not the separate workers process that consumes domain
// events and actually writes a notification row.
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

test.describe('notification preferences', () => {
  test('is reachable from settings', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings');
    // The nav bell's own link is also named "Notifications" (its
    // aria-label), so this matches on the card's fuller accessible name
    // (title plus description) rather than the bare word, which the bell
    // would satisfy too.
    await page.getByRole('link', { name: /Notifications.*reach you/ }).click();

    await expect(page).toHaveURL(/\/settings\/notifications$/);
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  });

  test('every template starts with both channels on, and a change persists across reload', async ({
    page,
  }) => {
    await signInAsManager(page);
    await page.goto('/settings/notifications');

    const emailBox = page.getByLabel('Email for Escalated to me');
    const inAppBox = page.getByLabel('In-app for Escalated to me');
    await expect(emailBox).toBeChecked();
    await expect(inAppBox).toBeChecked();

    await emailBox.setChecked(false);
    // The checkbox saves itself; there is no separate "Save" step.
    await expect(emailBox).not.toBeChecked();

    await page.reload();
    await expect(page.getByLabel('Email for Escalated to me')).not.toBeChecked();
    await expect(page.getByLabel('In-app for Escalated to me')).toBeChecked();

    // Restored, so this spec leaves the setting as it found it.
    await page.getByLabel('Email for Escalated to me').setChecked(true);
    await expect(page.getByLabel('Email for Escalated to me')).toBeChecked();
  });

  test('a colleague’s own preference is untouched by another user’s change', async ({ page }) => {
    await signInAsManager(page);
    await page.goto('/settings/notifications');
    await page.getByLabel('Email for Reminders').setChecked(false);
    await expect(page.getByLabel('Email for Reminders')).not.toBeChecked();

    await signIn(page);
    await page.goto('/settings/notifications');
    await expect(page.getByLabel('Email for Reminders')).toBeChecked();

    // Restore the manager's own setting.
    await signInAsManager(page);
    await page.goto('/settings/notifications');
    await page.getByLabel('Email for Reminders').setChecked(true);
  });

  test('turning off both channels for a template suppresses it entirely', async ({ page }) => {
    test.skip(
      REQUIRES_WORKERS,
      'needs the workers process consuming domain events; see the note above',
    );

    await signInAsManager(page);
    await page.goto('/settings/notifications');
    await page.getByLabel('Email for Assigned to me').setChecked(false);
    await page.getByLabel('In-app for Assigned to me').setChecked(false);

    await signIn(page);
    const reference = await submitLaptopRequest(page, '640');

    await signInAsManager(page);
    await page.goto('/notifications');
    await expect(page.getByRole('listitem').filter({ hasText: reference })).toHaveCount(0);

    // Restore, so this spec leaves the manager's preferences as it found
    // them, and so later specs relying on a real taskAssigned email or
    // in-app row (approvals.spec.ts, notifications.spec.ts) are unaffected.
    await page.goto('/settings/notifications');
    await page.getByLabel('Email for Assigned to me').setChecked(true);
    await page.getByLabel('In-app for Assigned to me').setChecked(true);
  });

  test('has no accessibility violations', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });
});
