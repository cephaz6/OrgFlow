import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

test.describe('members', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('is reachable from the navigation and lists the organisation', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Members' }).click();

    await expect(page).toHaveURL(/\/settings\/members$/);
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();

    // The seeded development user is the row that must always be present,
    // and it identifies itself so an administrator cannot mistake somebody
    // else's row for their own.
    const own = page.getByRole('row').filter({ hasText: 'dev@orgflow.local' });
    await expect(own).toContainText('(you)');
  });

  test('does not offer self-edit, which the API refuses anyway', async ({ page }) => {
    await page.goto('/settings/members');

    // ADR-0024: an administrator may not change their own roles or remove
    // themselves. Offering a control that is certain to fail would be worse
    // than not offering it.
    const own = page.getByRole('row').filter({ hasText: 'dev@orgflow.local' });
    await expect(own.getByRole('button', { name: /Edit roles/ })).toHaveCount(0);
    await expect(own.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  });

  test('filters the directory by name', async ({ page }) => {
    await page.goto('/settings/members');

    // The seeded line manager, who exists so the approval journey has two
    // people in it.
    await page.getByLabel(/Search members/).fill('Local Dev Manager');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(page.getByRole('row').filter({ hasText: 'manager@orgflow.local' })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'dev@orgflow.local' })).toHaveCount(0);
  });

  test('changes a colleague’s roles through a keyboard-reachable editor', async ({ page }) => {
    await page.goto('/settings/members');

    const colleague = page.getByRole('row').filter({ hasText: 'manager@orgflow.local' });
    await colleague.getByRole('button', { name: /Edit roles/ }).click();

    // A native checkbox group, so the label is the control's accessible name
    // and the description is announced with it.
    const processOwner = page.getByRole('checkbox', { name: 'Process owner' });
    await expect(processOwner).toBeVisible();

    // Flipped from whatever it currently is, rather than asserted to start
    // unchecked. This test grants a role against a database that persists
    // between runs, so a fixed expectation about the starting state is one
    // its own previous run would have invalidated. Restored at the end for
    // the same reason: a spec that leaves the directory changed makes the
    // next run of its neighbours depend on whether it ran.
    const grantedBefore = await processOwner.isChecked();
    await processOwner.setChecked(!grantedBefore);
    await page.getByRole('button', { name: 'Save roles' }).click();

    await expect(page.getByRole('button', { name: 'Save roles' })).toHaveCount(0);
    const row = page.getByRole('row').filter({ hasText: 'manager@orgflow.local' });
    if (grantedBefore) {
      await expect(row).not.toContainText('Process owner');
    } else {
      await expect(row).toContainText('Process owner');
    }

    // Put it back, so the directory reads the same after this spec as before.
    await row.getByRole('button', { name: /Edit roles/ }).click();
    await page.getByRole('checkbox', { name: 'Process owner' }).setChecked(grantedBefore);
    await page.getByRole('button', { name: 'Save roles' }).click();
    await expect(page.getByRole('button', { name: 'Save roles' })).toHaveCount(0);
  });

  test('has no accessibility violations', async ({ page }) => {
    await page.goto('/settings/members');
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test('has no accessibility violations with the role editor open', async ({ page }) => {
    await page.goto('/settings/members');

    await page
      .getByRole('row')
      .filter({ hasText: 'manager@orgflow.local' })
      .getByRole('button', { name: /Edit roles/ })
      .click();
    await expect(page.getByRole('checkbox', { name: 'Approver' })).toBeVisible();

    // The editor is the part most likely to fail: a checkbox group carries
    // labelling, grouping and description relationships that a table of
    // text does not.
    await expectNoAccessibilityViolations(page);
  });
});
