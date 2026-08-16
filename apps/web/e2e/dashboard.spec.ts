import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn, signInAsManager } from './support';

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

test.describe('dashboard', () => {
  test("shows a submitted request under the requester's open work", async ({ page }) => {
    await signIn(page);
    const reference = await submitLaptopRequest(page, '640');

    await page.goto('/');
    const section = page.getByRole('region', { name: /Your open requests/ });
    await expect(section).toContainText(reference);
    // The process name, resolved from the catalogue: the case list
    // projection carries only a definition id.
    await expect(section).toContainText('Laptop request');
    await expect(section).toContainText('In progress');
  });

  test('shows work waiting on the approver, most urgent first and capped', async ({ page }) => {
    await signIn(page);
    await submitLaptopRequest(page, '640');

    await signInAsManager(page);
    await page.goto('/');

    const section = page.getByRole('region', { name: /Waiting on you/ });
    await expect(section).toContainText('Line manager approval');
    // Urgency is words, never colour alone (PRD.md §13.2).
    await expect(section).toContainText(/Due in|Due today|Overdue|No deadline/);

    // Deliberately not asserting the request just submitted appears here.
    // The section shows the most urgent work, and a brand-new request has
    // the furthest-away deadline, so it belongs at the bottom of the full
    // queue rather than the top of this summary. Asserting otherwise would
    // be testing for the opposite of the intended ordering.
    const rows = section.getByRole('listitem');
    expect(await rows.count()).toBeLessThanOrEqual(5);

    // With more waiting than fits, the section defers to the full queue
    // rather than pretending five is all there is.
    await expect(section.getByRole('link', { name: /View all \d+ approvals/ })).toBeVisible();
  });

  test('links straight to the decision screen for a waiting approval', async ({ page }) => {
    await signIn(page);
    await submitLaptopRequest(page, '640');

    await signInAsManager(page);
    await page.goto('/');
    await page
      .getByRole('region', { name: /Waiting on you/ })
      .getByRole('listitem')
      .first()
      .getByRole('link')
      .click();

    await page.waitForURL(/\/approvals\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'Your decision' })).toBeVisible();
  });

  test('offers quick-start tiles that begin a request directly', async ({ page }) => {
    await signIn(page);
    await submitLaptopRequest(page, '640');

    await page.goto('/');
    await page
      .getByRole('region', { name: /Start something/ })
      .getByRole('link', { name: /Laptop request/ })
      .click();

    // Straight into the form, not via the catalogue detail page: the point
    // of a quick-start tile is skipping that step.
    await expect(page).toHaveURL(/\/cases\/new\/laptop-request$/);
    await expect(page.getByLabel(/Which model do you need/)).toBeVisible();
  });

  test('has no accessibility violations with content on it', async ({ page }) => {
    await signIn(page);
    await submitLaptopRequest(page, '640');

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });
});
