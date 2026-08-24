import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

// Reporting reads from cases that already exist, so a run against an empty
// database would exercise only the empty states. Submitting one request
// first is what puts a real bar on the volume chart and a real row in its
// text equivalent.
async function submitLaptopRequest(page: Page): Promise<void> {
  await page.goto('/cases/new/laptop-request');
  await page.getByLabel(/Which model do you need/).selectOption('mbp14');
  await page.getByLabel(/Estimated cost/).fill('640');
  await page
    .getByLabel(/Why do you need this/)
    .fill('The current machine no longer builds the project within a working day.');
  await page.getByLabel(/When do you need it by/).fill('2026-12-01');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.getByText(/^LAP-\d{6}$/)).toBeVisible();
}

test.describe('reports', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('is reachable from the navigation and shows the headline numbers', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Reports' }).click();

    await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();

    // PRD.md §17.1's three headline numbers. Scoped to the tiles rather than
    // the page, because "Median turnaround" is also a column header and part
    // of a table caption further down, and an unscoped match is ambiguous.
    const tiles = page.getByRole('main').locator('div.grid').first();
    await expect(tiles.getByText('Completion rate')).toBeVisible();
    await expect(tiles.getByText('Median turnaround')).toBeVisible();
    await expect(tiles.getByText('p90 turnaround')).toBeVisible();
  });

  test('pairs each chart with a text equivalent of the same numbers', async ({ page }) => {
    await submitLaptopRequest(page);
    await page.goto('/reports');

    // The charts are Recharts SVGs marked aria-hidden, so the only thing a
    // screen reader can reach is the visually-hidden table beside each one.
    // Asserting on the table by its caption is what proves the equivalent is
    // actually present, rather than the chart being the sole carrier of the
    // data (WCAG 2.2 AA non-text content).
    const volume = page.getByRole('table', { name: 'Cases submitted by period' });
    await expect(volume).toBeAttached();
    await expect(volume.getByRole('columnheader', { name: 'Cases submitted' })).toBeAttached();

    // One submitted request, so the table carries at least one data row
    // beyond its header.
    await expect(volume.getByRole('row')).not.toHaveCount(1);
  });

  test('has no accessibility violations with content on it', async ({ page }) => {
    await submitLaptopRequest(page);
    await page.goto('/reports');

    await expect(page.getByRole('heading', { name: 'Volume' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Bottlenecks' })).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test('reaches a single process report from the processes list', async ({ page }) => {
    await submitLaptopRequest(page);

    // The per-process report had no route into it at all until this link
    // existed: the navigation reaches /reports only, and the processes list
    // linked solely to the builder. A built page nothing points at is
    // invisible work, so this asserts the path rather than the page.
    await page.goto('/processes');
    await page.getByRole('link', { name: /Report for Laptop request/ }).click();

    await page.waitForURL(/\/reports\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: 'Laptop request', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Step duration' })).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test('offers a CSV export rather than leaving the numbers on screen only', async ({ page }) => {
    await submitLaptopRequest(page);
    await page.goto('/reports');

    // ADR-0022: the export is synchronous and streams straight back, so the
    // button is a real download rather than a queued job to poll for.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV' }).click();

    expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  });
});
