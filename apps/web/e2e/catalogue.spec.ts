import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

test.describe('catalogue and form runtime', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('lists the published processes, with no accessibility violations', async ({ page }) => {
    await page.goto('/catalogue');
    await expect(page.getByRole('heading', { name: 'Catalogue', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Laptop request' })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  test('shows what happens after submitting, with no accessibility violations', async ({
    page,
  }) => {
    await page.goto('/catalogue/laptop-request');
    await expect(page.getByRole('heading', { name: 'Laptop request', level: 1 })).toBeVisible();

    // The workflow shape, taken from the pinned definition document rather
    // than described in prose that could drift from it.
    await expect(page.getByText('Manager approval')).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  test('reveals a conditional field only once its condition holds', async ({ page }) => {
    await page.goto('/cases/new/laptop-request');

    // otherModelDetail is visibleWhen laptopModel eq 'other'.
    await expect(page.getByLabel(/Describe what you need/)).toBeHidden();
    await page.getByLabel(/Which model do you need/).selectOption('other');
    await expect(page.getByLabel(/Describe what you need/)).toBeVisible();

    await page.getByLabel(/Which model do you need/).selectOption('mbp14');
    await expect(page.getByLabel(/Describe what you need/)).toBeHidden();
  });

  test('reveals the quote field above the branch threshold', async ({ page }) => {
    await page.goto('/cases/new/laptop-request');

    // The same £1000 threshold the workflow branches on, so this is the
    // form agreeing with the engine rather than a separate rule.
    await page.getByLabel(/Estimated cost/).fill('900');
    await expect(page.getByText('Attachments are not available yet')).toBeHidden();

    await page.getByLabel(/Estimated cost/).fill('1500');
    await expect(page.getByText('Attachments are not available yet')).toBeVisible();
  });

  test('refuses to submit an incomplete request and says what is wrong', async ({ page }) => {
    await page.goto('/cases/new/laptop-request');
    await page.getByRole('button', { name: 'Submit request' }).click();

    const summary = page.getByRole('alert').first();
    await expect(summary).toContainText('problems with this request');
    // Focus moves to the summary so the count is announced before the
    // requester is dropped into any one field.
    await expect(summary).toBeFocused();

    await expect(page.getByText('Use at least 20 characters.')).toBeHidden();
    await expect(page.getByRole('alert').filter({ hasText: 'Enter an answer.' })).not.toHaveCount(
      0,
    );

    await expectNoAccessibilityViolations(page);
  });

  test('submits a request and returns its reference', async ({ page }) => {
    await page.goto('/cases/new/laptop-request');

    await page.getByLabel(/Which model do you need/).selectOption('mbp14');
    await page.getByLabel(/Estimated cost/).fill('900');
    await page
      .getByLabel(/Why do you need this/)
      .fill('My current laptop no longer holds charge for a full working day.');
    await page.getByLabel(/When do you need it by/).fill('2026-12-01');

    await page.getByRole('button', { name: 'Submit request' }).click();

    await expect(page.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
    // The reference is allocated by the API at submission (ADR-0013), so
    // matching its shape proves the whole round trip rather than that a
    // string was rendered.
    await expect(page.getByText(/^LAP-\d{6}$/)).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });
});
