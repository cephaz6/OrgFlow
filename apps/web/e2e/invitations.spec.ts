import { expect, test } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn, signInAsManager } from './support';

test.describe('invitations', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('sends an invitation and lists it as pending', async ({ page }) => {
    const email = `e2e-invitee-${Date.now()}@example.invalid`;

    await page.goto('/settings/members/invite');
    await page.getByLabel('Work email').fill(email);
    await page.getByRole('checkbox', { name: 'Approver' }).check();
    await page.getByRole('button', { name: 'Send invitation' }).click();

    // The dummy email sender never reaches a real inbox locally (ADR-0025),
    // so the link is shown regardless, and this is the only way this test
    // can reach the accept screen at all. Scoped to the status region: the
    // sr-only "Revoke" label on the invitations page would otherwise also
    // match a bare text search for the same email.
    const confirmation = page.getByRole('status');
    await expect(confirmation).toContainText(email);
    await expect(confirmation).toContainText('/invitations/');

    await page.goto('/settings/members/invitations');
    await expect(
      page.getByRole('row').filter({ hasText: email }).getByText('Pending'),
    ).toBeVisible();
  });

  test('revokes a pending invitation', async ({ page }) => {
    const email = `e2e-revoke-${Date.now()}@example.invalid`;

    await page.goto('/settings/members/invite');
    await page.getByLabel('Work email').fill(email);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByRole('status')).toContainText(email);

    await page.goto('/settings/members/invitations');
    await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible();

    await page
      .getByRole('row')
      .filter({ hasText: email })
      .getByRole('button', { name: /Revoke/ })
      .click();

    await expect(page.getByRole('row').filter({ hasText: email })).toContainText('Revoked');
  });

  test('shows when an invitation was sent, and can be found by searching for its email', async ({
    page,
  }) => {
    // Not "search" in the local part: the Revoke button's accessible name
    // ("Revoke invitation to <email>") would then itself match a
    // substring lookup for the Search button below.
    const email = `e2e-findme-${Date.now()}@example.invalid`;

    await page.goto('/settings/members/invite');
    await page.getByLabel('Work email').fill(email);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByRole('status')).toContainText(email);

    await page.goto('/settings/members/invitations');
    const row = page.getByRole('row').filter({ hasText: email });
    // "Sent" is a real date, not blank: the column exists and the
    // createdAt value the API already returned is actually rendered.
    // Columns after the email row-header are Roles, Status, Sent, Actions.
    await expect(row.getByRole('cell').nth(2)).not.toBeEmpty();

    const searchForm = page.getByRole('search');
    await searchForm.getByLabel(/Search invitations/).fill(email);
    await searchForm.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByRole('row').filter({ hasText: email })).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: '@example.invalid' })).toHaveCount(1);
  });

  test('has no accessibility violations on the invite form or the invitations list', async ({
    page,
  }) => {
    await page.goto('/settings/members/invite');
    await expect(page.getByRole('heading', { name: 'Invite a member', level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.getByLabel('Work email').fill(`e2e-a11y-${Date.now()}@example.invalid`);
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByRole('status')).toContainText('/invitations/');
    await expectNoAccessibilityViolations(page);

    await page.goto('/settings/members/invitations');
    await expect(page.getByRole('heading', { name: 'Invitations', level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page);
  });

  test('says an unknown link is not valid', async ({ page }) => {
    await page.goto('/invitations/not-a-real-token');

    await expect(
      page.getByRole('heading', { name: 'This link is not valid', level: 1 }),
    ).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  // The seeded manager (ADR-0002's dev-login path) is the only second
  // identity available locally, so this exercises the existing-member
  // reactivation branch of accept rather than a genuinely new user: there
  // is no way to complete a real OIDC sign-in as an arbitrary address in
  // this environment. members.integration.test.ts and
  // invitations.integration.test.ts cover the brand-new-user path directly
  // against the API.
  test('accepts an invitation as the invited person, through a real sign-in', async ({ page }) => {
    await page.goto('/settings/members/invite');
    await page.getByLabel('Work email').fill('manager@orgflow.local');
    // Both Approver and Admin, not Admin alone. Acceptance replaces the
    // roles a membership holds outright (ADR-0025's own reactivation path),
    // not merges into them, so an invitation granting only Admin would drop
    // the seeded Approver role for the whole window between accepting and
    // this test restoring it. Other files (approvals.spec.ts,
    // dashboard.spec.ts) run in parallel and rely on the manager holding
    // Approver throughout; including it here means the replacement set
    // never actually lacks it, so there is no window to race.
    await page.getByRole('checkbox', { name: 'Approver' }).check();
    await page.getByRole('checkbox', { name: 'Admin' }).check();
    await page.getByRole('button', { name: 'Send invitation' }).click();

    const linkText = await page.getByRole('status').textContent();
    const path = linkText!.match(/\/invitations\/[a-f0-9]+/)![0];

    await signInAsManager(page);
    await page.goto(path);

    await expect(page.getByRole('heading', { name: /Join/, level: 1 })).toBeVisible();
    await expectNoAccessibilityViolations(page);

    await page.getByRole('button', { name: 'Accept invitation' }).click();
    await page.waitForURL('/');

    await signIn(page);
    await page.goto('/settings/members/directory');
    // Scoped to the members table specifically: the same email also
    // appears in the invitations list, in a now-"Accepted" row that
    // carries the requested roles too, but that is a different page now.
    const membersTable = page.getByRole('table', {
      name: 'Members of this organisation, their roles and their line manager',
    });
    const managerRow = membersTable.getByRole('row').filter({ hasText: 'manager@orgflow.local' });
    await expect(managerRow).toContainText('Admin');

    // Back to the seed's exact roles afterward: leaving Admin granted
    // would change what every later test run sees signed in as the
    // manager, the same reason members.spec.ts's own role-editor test
    // restores whatever it touches.
    await managerRow.getByRole('button', { name: /Edit roles/ }).click();
    const editor = page.getByRole('group', { name: 'Roles for Local Dev Manager' });
    await editor.getByRole('checkbox', { name: 'Approver' }).check();
    await editor.getByRole('checkbox', { name: 'Admin' }).uncheck();
    await page.getByRole('button', { name: 'Save roles' }).click();
    await expect(page.getByRole('button', { name: 'Save roles' })).toHaveCount(0);
    await expect(managerRow).not.toContainText('Admin');
  });
});
