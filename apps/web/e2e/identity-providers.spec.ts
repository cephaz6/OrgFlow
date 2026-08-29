import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

function providersTable(page: Page) {
  return page.getByRole('table', {
    name: 'Identity providers configured for this organisation',
  });
}

test.describe('identity providers', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('is reachable from the navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Identity providers' }).click();

    await expect(page).toHaveURL(/\/settings\/identity-providers$/);
    await expect(page.getByRole('heading', { name: 'Identity providers', level: 1 })).toBeVisible();
  });

  test('adds, edits, disables and removes a provider', async ({ page }) => {
    await page.goto('/settings/identity-providers');

    await page.getByLabel('Display name').fill('E2E Test Provider');
    await page.getByLabel('Issuer URL').fill('https://login.e2e-test.example');
    await page.getByLabel('Client ID').fill('e2e-test-client-id');
    await page
      .getByLabel('Client secret ARN')
      .fill('arn:aws:secretsmanager:eu-west-2:000000000000:secret:e2e-test');
    await page.getByLabel('Email domains').fill('e2e-test.example');
    await page.getByRole('button', { name: 'Add identity provider' }).click();

    const row = providersTable(page).getByRole('row').filter({ hasText: 'E2E Test Provider' });
    await expect(row).toBeVisible();
    await expect(row).toContainText('e2e-test.example');
    await expect(row).toContainText('Enabled');

    // Disable, then confirm the status flips without a page reload changing
    // anything else in the row.
    await row.getByRole('button', { name: /Disable/ }).click();
    await expect(row).toContainText('Disabled');

    // Edit through the inline editor, the same pattern the members
    // directory's role editor uses.
    await row.getByRole('button', { name: /^Edit/ }).click();
    const nameField = page.getByLabel('Display name', { exact: false }).last();
    await nameField.fill('E2E Test Provider Renamed');
    await page.getByRole('button', { name: 'Save changes' }).click();

    const renamedRow = providersTable(page)
      .getByRole('row')
      .filter({ hasText: 'E2E Test Provider Renamed' });
    await expect(renamedRow).toBeVisible();

    await renamedRow.getByRole('button', { name: /Remove/ }).click();
    await expect(
      providersTable(page).getByRole('row').filter({ hasText: 'E2E Test Provider Renamed' }),
    ).toHaveCount(0);
  });

  test('rejects a client secret ARN that is not a real ARN', async ({ page }) => {
    await page.goto('/settings/identity-providers');

    await page.getByLabel('Display name').fill('Bad Secret Provider');
    await page.getByLabel('Issuer URL').fill('https://login.e2e-bad-secret.example');
    await page.getByLabel('Client ID').fill('bad-secret-client-id');
    await page.getByLabel('Client secret ARN').fill('not-an-arn');
    await page.getByLabel('Email domains').fill('e2e-bad-secret.example');
    await page.getByRole('button', { name: 'Add identity provider' }).click();

    await expect(page.getByText('clientSecretRef must be the Secrets Manager ARN')).toBeVisible();
    await expect(
      providersTable(page).getByRole('row').filter({ hasText: 'Bad Secret Provider' }),
    ).toHaveCount(0);
  });

  test('has no accessibility violations, including with the editor open', async ({ page }) => {
    await page.goto('/settings/identity-providers');
    await expect(page.getByRole('heading', { name: 'Identity providers', level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.getByLabel('Display name').fill('A11y Test Provider');
    await page.getByLabel('Issuer URL').fill('https://login.e2e-a11y.example');
    await page.getByLabel('Client ID').fill('a11y-client-id');
    await page
      .getByLabel('Client secret ARN')
      .fill('arn:aws:secretsmanager:eu-west-2:000000000000:secret:e2e-a11y');
    await page.getByLabel('Email domains').fill('e2e-a11y.example');
    await page.getByRole('button', { name: 'Add identity provider' }).click();

    const row = providersTable(page).getByRole('row').filter({ hasText: 'A11y Test Provider' });
    await row.getByRole('button', { name: /^Edit/ }).click();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    // Clean up, so this spec leaves the directory the way it found it.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await row.getByRole('button', { name: /Remove/ }).click();
    await expect(
      providersTable(page).getByRole('row').filter({ hasText: 'A11y Test Provider' }),
    ).toHaveCount(0);
  });
});
