import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

// Above £1,000, which is what makes the seeded "quote" field
// (packages/documents/src/seed/laptop-request.ts) visible at all.
async function startAboveThresholdRequest(page: Page): Promise<void> {
  await page.goto('/cases/new/laptop-request');
  await expect(page.getByText('Preparing your request...')).toHaveCount(0, { timeout: 15_000 });
  await page.getByLabel(/Which model do you need/).selectOption('mbp16');
  await page.getByLabel(/Estimated cost/).fill('1500');
  await page
    .getByLabel(/Why do you need this/)
    .fill('The current machine no longer builds the project within a working day.');
  await page.getByLabel(/When do you need it by/).fill('2026-12-01');
}

test.describe('attachments', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('uploads a file against a real draft before the request is ever submitted', async ({
    page,
  }) => {
    await startAboveThresholdRequest(page);

    await expect(page.getByText('Attach a supplier quote')).toBeVisible();

    await page.getByLabel(/Attach a supplier quote/).setInputFiles({
      name: 'quote.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%test quote\n'),
    });

    // Scanning, not "Available": nothing in this local environment
    // consumes the attachment.uploaded event (that is workers/, a separate
    // process this suite does not run), so the attachment is confirmed but
    // never actually scanned. That is the honest state to assert, not a
    // stand-in for a scan that never happens here.
    await expect(page.getByText('quote.pdf', { exact: true })).toBeVisible();
    await expect(page.getByText('Scanning')).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test('removes an uploaded file before submitting', async ({ page }) => {
    await startAboveThresholdRequest(page);

    await page.getByLabel(/Attach a supplier quote/).setInputFiles({
      name: 'quote.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%test quote\n'),
    });
    await expect(page.getByText('quote.pdf', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: /Remove quote.pdf/ }).click();
    await expect(page.getByText('quote.pdf', { exact: true })).toHaveCount(0);
  });

  test('refuses a file of a type the field does not accept', async ({ page }) => {
    await startAboveThresholdRequest(page);

    await page.getByLabel(/Attach a supplier quote/).setInputFiles({
      name: 'quote.exe',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from('not a real executable'),
    });

    // Scoped past text rather than getByRole('alert') alone: Next's own
    // route announcer is also role="alert" on every page.
    await expect(page.getByText('does not accept files of this type')).toBeVisible();
  });

  test('carries an uploaded attachment through to the submitted case', async ({ page }) => {
    await startAboveThresholdRequest(page);

    await page.getByLabel(/Attach a supplier quote/).setInputFiles({
      name: 'quote.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n%test quote\n'),
    });
    await expect(page.getByText('quote.pdf', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Submit request' }).click();
    const reference = page.getByText(/^LAP-\d{6}$/);
    await expect(reference).toBeVisible();

    await page.getByRole('link', { name: 'Track this request' }).click();
    await expect(page.getByRole('heading', { name: 'Attachments' })).toBeVisible();
    await expect(page.getByText('quote.pdf', { exact: true })).toBeVisible();
  });
});
