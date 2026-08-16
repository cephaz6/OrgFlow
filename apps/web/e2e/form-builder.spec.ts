import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

test.describe('form builder', () => {
  test('creates a process, builds a form and publishes it', async ({ page }) => {
    // A longer end-to-end journey than most specs here: create, build,
    // switch tabs, publish, and check the catalogue, each a real
    // navigation or API round trip.
    test.setTimeout(60_000);
    await signIn(page);

    await page.goto('/processes');
    await expect(page.getByRole('heading', { name: 'Processes', level: 1 })).toBeVisible();
    await page.getByRole('link', { name: 'New process' }).click();

    await expect(page).toHaveURL('/processes/new');
    const name = `Expense claim ${Date.now()}`;
    await page.getByLabel('Process name').fill(name);
    await page.getByLabel('Reference prefix').fill('exp');
    await page.getByRole('button', { name: 'Create and open the builder' }).click();

    await page.waitForURL(/\/processes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();

    // Build: one section, two fields, reordered by keyboard.
    await page.getByRole('button', { name: 'Add section' }).click();
    await page.getByLabel('Section title').fill('Details');

    await page.getByRole('button', { name: 'Short text' }).click();
    await page.getByLabel('Question label').fill('Amount');

    await page.getByRole('button', { name: 'Long text' }).click();
    await page.getByLabel('Question label').fill('Reason');

    // Reason was added after Amount, so it starts second; moving it up
    // (the keyboard equivalent of the drag handle beside it, CLAUDE.md §3)
    // should put it first.
    const buildPanel = page.locator('#panel-build');
    const fieldButtons = buildPanel.getByRole('button', { name: /^(Amount|Reason)/ });
    await expect(fieldButtons.first()).toContainText('Amount');

    await page.getByRole('button', { name: 'Move "Reason" up' }).click();
    await expect(fieldButtons.first()).toContainText('Reason');

    // Preview reflects the same two fields through the real runtime. Scoped
    // to the preview panel: the build panel's own controls (a "Move
    // <field>" button, a drag handle) also carry the field's name in their
    // accessible name, and `hidden` on the inactive tabpanel does not
    // exclude its descendants from getByLabel's search, only from
    // visibility.
    await page.getByRole('tab', { name: 'preview' }).click();
    const previewPanel = page.locator('#panel-preview');
    await expect(previewPanel.getByLabel('Reason')).toBeVisible();
    await expect(previewPanel.getByLabel('Amount')).toBeVisible();

    // Validate: an empty form would warn, but two labelled text fields in
    // one section should raise nothing.
    await page.getByRole('tab', { name: /validate/i }).click();
    await expect(page.getByText('No problems found.')).toBeVisible();

    // Publish.
    await page.getByRole('tab', { name: 'build' }).click();
    await page.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published as v1')).toBeVisible();

    // The published process now appears in the catalogue.
    await page.goto('/catalogue');
    await expect(page.getByText(name)).toBeVisible();
  });

  test('has no accessibility violations on the builder screen', async ({ page }) => {
    await signIn(page);

    await page.goto('/processes/new');
    await page.getByLabel('Process name').fill(`Accessibility check ${Date.now()}`);
    await page.getByLabel('Reference prefix').fill('acc');
    await page.getByRole('button', { name: 'Create and open the builder' }).click();
    await page.waitForURL(/\/processes\/[0-9a-f-]{36}$/);

    await page.getByRole('button', { name: 'Add section' }).click();
    await page.getByRole('button', { name: 'Short text' }).click();

    await expectNoAccessibilityViolations(page);
  });

  test('shows the Processes nav item for a process-owning session', async ({ page }) => {
    // dev-login signs in holding every role (packages/db/src/repositories/
    // dev-seed.ts), processOwner included, which is what nav.ts's
    // requiresAnyRole gate checks before showing the item at all.
    await signIn(page);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Processes' })).toBeVisible();
  });
});
