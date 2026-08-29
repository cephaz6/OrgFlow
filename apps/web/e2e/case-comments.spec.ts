import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

// Fills and submits the seeded Laptop Request, returning its reference.
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

test.describe('case comments', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('posts a comment and shows it in the thread', async ({ page }) => {
    const reference = await submitLaptopRequest(page, '650');
    await page.getByRole('link', { name: 'Track this request' }).click();
    await expect(page.getByRole('heading', { name: reference, level: 1 })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Comments' })).toBeVisible();
    await expect(page.getByText('No comments yet')).toBeVisible();

    await page.getByLabel('Add a comment').fill('Can you confirm the delivery address?');
    await page.getByRole('button', { name: 'Post comment' }).click();

    await expect(page.getByText('Can you confirm the delivery address?')).toBeVisible();
    await expect(page.getByText('No comments yet')).toHaveCount(0);
  });

  test('does not offer an internal-note option to the requester', async ({ page }) => {
    const reference = await submitLaptopRequest(page, '650');
    await page.getByRole('link', { name: 'Track this request' }).click();
    await expect(page.getByRole('heading', { name: reference, level: 1 })).toBeVisible();

    // The submitter's own case: canPostInternalNote is deliberately false
    // for the requester, whatever roles they otherwise hold.
    await expect(page.getByLabel('Internal note (hidden from the requester)')).toHaveCount(0);
  });

  test('has no accessibility violations with a comment posted', async ({ page }) => {
    const reference = await submitLaptopRequest(page, '650');
    await page.getByRole('link', { name: 'Track this request' }).click();
    await expect(page.getByRole('heading', { name: reference, level: 1 })).toBeVisible();

    await page.getByLabel('Add a comment').fill('A question worth asking.');
    await page.getByRole('button', { name: 'Post comment' }).click();
    await expect(page.getByText('A question worth asking.')).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });
});
