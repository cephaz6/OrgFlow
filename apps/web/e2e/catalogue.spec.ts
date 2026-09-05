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

  test('finds a process by name, and shows pagination controls disabled on a single page', async ({
    page,
  }) => {
    await page.goto('/catalogue');

    await page.getByLabel(/Search the catalogue/).fill('Laptop request');
    await page.getByRole('search').getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('link', { name: 'Laptop request' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Expense claim' })).toHaveCount(0);

    // The seeded catalogue is far smaller than one page, so this asserts
    // the controls render and are correctly disabled at the boundary,
    // rather than a real Next/Previous round trip.
    const pagination = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pagination.getByText('Previous')).toHaveAttribute('aria-disabled', 'true');
    await expect(pagination.getByText('Next')).toHaveAttribute('aria-disabled', 'true');
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

  test('announces a conditional field arriving and leaving, for a screen reader', async ({
    page,
  }) => {
    await page.goto('/cases/new/laptop-request');

    // The claim is not that the region exists, it is that a change a
    // sighted requester sees is spoken to somebody who cannot. The region
    // is visually hidden, so its text is read rather than its visibility.
    const liveRegion = page.getByRole('status');
    await expect(liveRegion).toHaveText('');

    await page.getByLabel(/Which model do you need/).selectOption('other');
    await expect(liveRegion).toHaveText(/Describe what you need added/);

    await page.getByLabel(/Which model do you need/).selectOption('mbp14');
    await expect(liveRegion).toHaveText(/Describe what you need removed/);
  });

  test('reveals the quote field above the branch threshold', async ({ page }) => {
    await page.goto('/cases/new/laptop-request');

    // The same £1000 threshold the workflow branches on, so this is the
    // form agreeing with the engine rather than a separate rule.
    // Exact, because the live region announcing the same field says
    // "Attach a supplier quote added." and a substring match resolves to
    // both it and the label.
    const quoteLabel = page.getByText('Attach a supplier quote', { exact: true });

    await page.getByLabel(/Estimated cost/).fill('900');
    await expect(quoteLabel).toBeHidden();

    await page.getByLabel(/Estimated cost/).fill('1500');
    await expect(quoteLabel).toBeVisible();
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
