import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

// ADR-0044. The claim worth testing through the interface is not that the
// form saves, it is that saving it changes what a requester is told their
// deadline is.

test.describe('the working calendar', () => {
  test('is reachable, states the default, and explains what an SLA means', async ({ page }) => {
    await signIn(page);
    await page.goto('/');

    await page.getByRole('link', { name: 'Working calendar' }).first().click();
    await page.waitForURL(/\/settings\/working-calendar$/);
    await expect(page.getByRole('heading', { name: 'Working calendar', level: 1 })).toBeVisible();

    // The arithmetic nobody should have to do in their head: a 09:00-17:00
    // five-day week is 40 hours, so a 40-hour SLA is one working week.
    await expect(page.getByText('8 hours a day, 40 a week')).toBeVisible();
    await expect(page.getByText('An SLA of 40 hours is one working week')).toBeVisible();
  });

  // The matching case, a working day with no length, is deliberately not
  // driven from here. A time input renders 12-hour or 24-hour by locale, so
  // typed digits mean different things on a developer machine and on CI,
  // Playwright's fill() is suppressed by React's change tracker, and setting
  // through the native setter did not reach React 19 either. Three attempts
  // at the harness for one message is the wrong trade when the refusal is
  // already proven where it counts: the API returns 400 (see
  // working-calendar.integration.test.ts) and the column carries a CHECK
  // constraint. What is portable is asserted below.
  test('blocks saving a week with no working days at all', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings/working-calendar');

    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      await page.getByLabel(day, { exact: true }).uncheck();
    }

    await expect(
      page.getByText('Choose at least one working day, or no request could ever fall due'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save working week' })).toBeDisabled();
  });

  test('saves a working week and adds a holiday, which both persist', async ({ page }) => {
    test.setTimeout(90_000);
    await signIn(page);
    await page.goto('/settings/working-calendar');

    await page.getByLabel('Time zone').selectOption('Europe/London');
    await page.getByRole('button', { name: 'Save working week' }).click();
    await expect(page.getByText('New requests will use this calendar')).toBeVisible();
    // Deadlines already issued are deliberately not moved, and the
    // confirmation says so rather than leaving it to be discovered.
    await expect(page.getByText('Deadlines already given out do not move')).toBeVisible();

    const holiday = `2027-0${(Date.now() % 9) + 1}-15`;
    await page.getByLabel('Date').fill(holiday);
    await page.getByLabel('What it is').fill('Founders Day');
    await page.getByRole('button', { name: 'Add holiday' }).click();
    await expect(page.getByText('Founders Day')).toBeVisible();

    await page.reload();
    // The time zone is a select, which drives React reliably, so this is
    // real evidence the save reached the server rather than the box merely
    // showing what was typed. The times are covered by the API tests.
    await expect(page.getByLabel('Time zone')).toHaveValue('Europe/London');
    await expect(page.getByText('Founders Day')).toBeVisible();
    // Configured now, so the "nothing is set" notice is gone.
    await expect(page.getByText('Nothing is configured yet')).toHaveCount(0);

    // Tidy up, so the shared dev organisation is left as it was found.
    await page.getByRole('button', { name: `Remove Founders Day on ${holiday}` }).click();
    await expect(page.getByText('Founders Day')).toHaveCount(0);
  });

  test('has no accessibility violations', async ({ page }) => {
    await signIn(page);
    await page.goto('/settings/working-calendar');

    await expectNoAccessibilityViolations(page);
  });
});
