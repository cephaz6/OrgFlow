import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

test.describe('save a request for later', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('saves an incomplete request, lists it as a draft, and resumes it', async ({ page }) => {
    await page.goto('/cases/new/laptop-request');

    await page.getByLabel(/Which model do you need/).selectOption('mbp14');
    await page.getByLabel(/Estimated cost/).fill('900');
    // Deliberately left incomplete: the point of a draft is that it need
    // not pass validation the way a submission does.
    await page.getByRole('button', { name: 'Save and finish later' }).click();

    // A client-side navigation, so the same generous allowance the
    // "Preparing your request..." transient gets elsewhere covers a route
    // the dev server has not compiled yet.
    await expect(page.getByRole('heading', { name: 'My requests', level: 1 })).toBeVisible({
      timeout: 15_000,
    });
    const row = page.getByRole('row').filter({ hasText: 'Laptop request' }).first();
    await expect(row).toContainText('Draft');
    await expect(row).toContainText('Not submitted');

    await row.getByRole('link').first().click();
    await expect(page.getByText('Not yet submitted').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Continue this request' })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.getByRole('link', { name: 'Continue this request' }).click();
    await expect(
      page.getByRole('heading', { name: 'Continue Laptop request', level: 1 }),
    ).toBeVisible({ timeout: 15_000 });

    // The answer already given is pre-populated, not asked again.
    await expect(page.getByLabel(/Which model do you need/)).toHaveValue('mbp14');
    await expect(page.getByLabel(/Estimated cost/)).toHaveValue('900');

    await page
      .getByLabel(/Why do you need this/)
      .fill('My current laptop no longer holds charge for a full working day.');
    await page.getByLabel(/When do you need it by/).fill('2026-12-01');
    await page.getByRole('button', { name: 'Submit request' }).click();

    await expect(page.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
    await expect(page.getByText(/^LAP-\d{6}$/)).toBeVisible();
  });

  test('does not offer continuing a request that has already been submitted', async ({ page }) => {
    await page.goto('/cases/new/laptop-request');
    await page.getByLabel(/Which model do you need/).selectOption('mbp14');
    await page.getByLabel(/Estimated cost/).fill('640');
    await page
      .getByLabel(/Why do you need this/)
      .fill('The current machine no longer builds the project within a working day.');
    await page.getByLabel(/When do you need it by/).fill('2026-12-01');
    await page.getByRole('button', { name: 'Submit request' }).click();
    await page.getByRole('link', { name: 'Track this request' }).click();

    await expect(page.getByRole('link', { name: 'Continue this request' })).toBeHidden();
  });

  test('redirects away from the continue form once the case is no longer a draft', async ({
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

    await page.waitForURL(/\/cases\/[0-9a-f-]{36}$/);
    const url = page.url();
    const caseId = url.slice(url.lastIndexOf('/') + 1);

    // Reaching the resume form directly on a submitted case must not
    // present a form the API would refuse with 409.
    await page.goto(`/cases/${caseId}/continue`);
    await expect(page).toHaveURL(new RegExp(`/cases/${caseId}$`));
  });
});
