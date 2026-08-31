import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

function groupsTable(page: Page) {
  return page.getByRole('table', { name: 'Groups configured for this organisation' });
}

test.describe('groups', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('is reachable from the navigation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Groups' }).click();

    await expect(page).toHaveURL(/\/settings\/groups$/);
    await expect(page.getByRole('heading', { name: 'Groups', level: 1 })).toBeVisible();
  });

  test('creates a group, deriving a key from the name, then renames and deletes it', async ({
    page,
  }) => {
    // Suffixed, not a fixed literal: groups no longer enforce a unique
    // display name (only the derived key is unique), so a fixed name would
    // collide with whatever an earlier, possibly-aborted run of this same
    // spec left behind, the same reason invitations.spec.ts and
    // form-builder.spec.ts suffix their own created names.
    const name = `E2E Test Group ${Date.now()}`;
    await page.goto('/settings/groups');

    await page.getByLabel('Name').fill(name);
    await page.getByLabel('Description').fill('Created by the e2e suite');
    await page.getByRole('button', { name: 'Create group' }).click();

    const row = groupsTable(page).getByRole('row').filter({ hasText: name });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Created by the e2e suite');

    await row.getByRole('button', { name: /^Edit/ }).click();
    const nameField = page.getByLabel('Name', { exact: false }).last();
    await nameField.fill(`${name} Renamed`);
    await page.getByRole('button', { name: 'Save changes' }).click();

    const renamedRow = groupsTable(page)
      .getByRole('row')
      .filter({ hasText: `${name} Renamed` });
    await expect(renamedRow).toBeVisible();
    // The rename must not have touched the key: ADR-0014's whole point.
    // The key was derived from the pre-rename name, so it still carries
    // it, kebab-cased, even though the display name has since moved on.
    await expect(renamedRow).toContainText('e2e-test-group');

    await renamedRow.getByRole('button', { name: /Delete/ }).click();
    await expect(
      groupsTable(page)
        .getByRole('row')
        .filter({ hasText: `${name} Renamed` }),
    ).toHaveCount(0);
  });

  test('adds a member to a group, then removes them, from the group detail page', async ({
    page,
  }) => {
    const name = `E2E Membership Group ${Date.now()}`;
    await page.goto('/settings/groups');

    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create group' }).click();

    const row = groupsTable(page).getByRole('row').filter({ hasText: name });
    await row.getByRole('link', { name: /Members/ }).click();

    await expect(page).toHaveURL(/\/settings\/groups\/[^/]+$/);
    await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
    await expect(page.getByText('Nobody in this group yet')).toBeVisible();

    // The seeded line manager, the only other member available locally.
    await page
      .getByLabel('Add a member')
      .selectOption({ label: 'Local Dev Manager (manager@orgflow.local)' });
    await page.getByRole('button', { name: 'Add' }).click();

    const memberRow = page.getByRole('listitem').filter({ hasText: 'Local Dev Manager' });
    await expect(memberRow).toBeVisible();

    await memberRow.getByRole('button', { name: /Remove/ }).click();
    await expect(page.getByText('Nobody in this group yet')).toBeVisible();

    // Clean up, so this spec leaves the directory the way it found it.
    await page.goto('/settings/groups');
    await groupsTable(page)
      .getByRole('row')
      .filter({ hasText: name })
      .getByRole('button', { name: /Delete/ })
      .click();
  });

  test('has no accessibility violations, including with the editor open', async ({ page }) => {
    const name = `A11y Test Group ${Date.now()}`;
    await page.goto('/settings/groups');
    await expect(page.getByRole('heading', { name: 'Groups', level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.getByLabel('Name').fill(name);
    await page.getByRole('button', { name: 'Create group' }).click();

    const row = groupsTable(page).getByRole('row').filter({ hasText: name });
    await row.getByRole('button', { name: /^Edit/ }).click();
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.getByRole('button', { name: 'Cancel' }).click();
    await row.getByRole('button', { name: /Delete/ }).click();
    await expect(groupsTable(page).getByRole('row').filter({ hasText: name })).toHaveCount(0);
  });
});
