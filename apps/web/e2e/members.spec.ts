import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

// Scoped to the members table specifically, on /settings/members/directory.
// It shares the app with an invitations table elsewhere, and the same
// email can appear in both, so an unscoped row lookup risks a strict-mode
// violation the moment even one invitation to that address exists.
function membersTable(page: Page) {
  return page.getByRole('table', {
    name: 'Members of this organisation, their roles and their line manager',
  });
}

test.describe('members', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('is reachable from the navigation, and links through to the directory', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Members' }).click();

    await expect(page).toHaveURL(/\/settings\/members$/);
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();

    // Three destinations, not one long page (features/invitations,
    // features/members): invite, invitations and the directory.
    await expect(page.getByRole('link', { name: /Invite a member/ })).toBeVisible();
    await expect(page.getByRole('link', { name: /Invitations/ })).toBeVisible();

    await page.getByRole('link', { name: /Active members/ }).click();
    await expect(page).toHaveURL(/\/settings\/members\/directory$/);

    // The seeded development user is the row that must always be present,
    // and it identifies itself so an administrator cannot mistake somebody
    // else's row for their own.
    const own = membersTable(page).getByRole('row').filter({ hasText: 'dev@orgflow.local' });
    await expect(own).toContainText('(you)');

    // The tab bar lets an administrator switch between the three sections
    // directly, without a round trip through the overview each time.
    await page
      .getByRole('navigation', { name: 'Members sections' })
      .getByRole('link', { name: 'Invitations' })
      .click();
    await expect(page).toHaveURL(/\/settings\/members\/invitations$/);
  });

  test('does not offer self-edit, which the API refuses anyway', async ({ page }) => {
    await page.goto('/settings/members/directory');

    // ADR-0024: an administrator may not change their own roles or remove
    // themselves. Offering a control that is certain to fail would be worse
    // than not offering it.
    const own = membersTable(page).getByRole('row').filter({ hasText: 'dev@orgflow.local' });
    await expect(own.getByRole('button', { name: /Edit roles/ })).toHaveCount(0);
    await expect(own.getByRole('button', { name: /Remove/ })).toHaveCount(0);
  });

  test('filters the directory by name', async ({ page }) => {
    await page.goto('/settings/members/directory');

    // The seeded line manager, who exists so the approval journey has two
    // people in it.
    await page.getByLabel(/Search members/).fill('Local Dev Manager');
    await page.getByRole('button', { name: 'Search' }).click();

    await expect(
      membersTable(page).getByRole('row').filter({ hasText: 'manager@orgflow.local' }),
    ).toBeVisible();
    await expect(
      membersTable(page).getByRole('row').filter({ hasText: 'dev@orgflow.local' }),
    ).toHaveCount(0);
  });

  test('changes a colleague’s roles through a keyboard-reachable editor', async ({ page }) => {
    await page.goto('/settings/members/directory');

    const colleague = membersTable(page)
      .getByRole('row')
      .filter({ hasText: 'manager@orgflow.local' });
    await colleague.getByRole('button', { name: /Edit roles/ }).click();

    // Scoped to this editor's own fieldset (legend "Roles for Local Dev
    // Manager"), not just to a checkbox named "Process owner": the invite
    // form on a different page shares this same accessible name for its
    // own checkbox, and while they are not both on screen at once here,
    // scoping to the editor keeps this test correct regardless.
    const editor = page.getByRole('group', { name: 'Roles for Local Dev Manager' });
    const processOwner = editor.getByRole('checkbox', { name: 'Process owner' });
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
    const row = membersTable(page).getByRole('row').filter({ hasText: 'manager@orgflow.local' });
    if (grantedBefore) {
      await expect(row).not.toContainText('Process owner');
    } else {
      await expect(row).toContainText('Process owner');
    }

    // Put it back, so the directory reads the same after this spec as before.
    await row.getByRole('button', { name: /Edit roles/ }).click();
    await editor.getByRole('checkbox', { name: 'Process owner' }).setChecked(grantedBefore);
    await page.getByRole('button', { name: 'Save roles' }).click();
    await expect(page.getByRole('button', { name: 'Save roles' })).toHaveCount(0);
  });

  test('shows pagination controls on the directory, disabled on a single page', async ({
    page,
  }) => {
    await page.goto('/settings/members/directory');

    // The seeded organisation has too few members to force a second page,
    // so this asserts the controls render and are correctly disabled at
    // the boundary, rather than exercising a real Next/Previous round trip
    // (which would need seeding dozens of throwaway members into the
    // shared local database to trigger).
    const pagination = page.getByRole('navigation', { name: 'Pagination' });
    await expect(pagination.getByRole('link', { name: /Previous/ })).toHaveCount(0);
    await expect(pagination.getByText('Previous')).toHaveAttribute('aria-disabled', 'true');
    await expect(pagination.getByRole('link', { name: /Next/ })).toHaveCount(0);
    await expect(pagination.getByText('Next')).toHaveAttribute('aria-disabled', 'true');
  });

  test('has no accessibility violations on the overview or the directory', async ({ page }) => {
    await page.goto('/settings/members');
    await expect(page.getByRole('heading', { name: 'Members', level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.goto('/settings/members/directory');
    await expect(page.getByRole('heading', { name: 'Active members', level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  test('has no accessibility violations with the role editor open', async ({ page }) => {
    await page.goto('/settings/members/directory');

    await membersTable(page)
      .getByRole('row')
      .filter({ hasText: 'manager@orgflow.local' })
      .getByRole('button', { name: /Edit roles/ })
      .click();
    await expect(
      page.getByRole('group', { name: 'Roles for Local Dev Manager' }).getByRole('checkbox', {
        name: 'Approver',
      }),
    ).toBeVisible();

    // The editor is the part most likely to fail: a checkbox group carries
    // labelling, grouping and description relationships that a table of
    // text does not.
    await expectNoAccessibilityViolations(page);
  });
});
