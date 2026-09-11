import { expect, test } from '@playwright/test';

import { REFLOW_VIEWPORT, expectNoHorizontalScroll, signIn } from './support';

// GOV-STANDARDS.md §11: "Usable at 400% zoom and 320px width." Until this
// file existed that box was unticked and unmeasured, and measuring it found
// every page in the application scrolling sideways.
//
// One spec covering many routes rather than a case added to each feature's
// own file: the failures this catches are almost never the feature's own
// markup. Three of the four found when it was written lived in the shared
// shell, in the sr-only pattern the tables use, and in the card row every
// list reuses, so a check that runs on one page per feature would have
// reported the same defect a dozen times over and still missed whichever
// page nobody thought to add it to.
test.describe('reflow at 320px', () => {
  test.use({ viewport: REFLOW_VIEWPORT });

  test('the sign-in page does not scroll horizontally', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Sign in to OrgFlow' })).toBeVisible();
    await expectNoHorizontalScroll(page);
  });

  // Every route reachable without creating anything, which is what makes
  // them safe to sweep: each one only reads.
  const authenticatedRoutes = [
    '/',
    '/catalogue',
    '/cases',
    '/approvals',
    '/processes',
    '/templates',
    '/notifications',
    '/reports',
    '/settings',
    '/settings/members',
    '/settings/members/directory',
    '/settings/groups',
    '/settings/working-calendar',
    '/settings/profile',
    '/settings/delegations',
    '/settings/identity-providers',
    '/settings/notifications',
    '/settings/data-protection',
  ];

  for (const route of authenticatedRoutes) {
    test(`${route} does not scroll horizontally`, async ({ page }) => {
      await signIn(page);
      await page.goto(route);

      // The shell's own landmark, so the assertion runs against a rendered
      // page rather than a blank one that would pass by having no content
      // wide enough to overflow.
      await expect(page.locator('#main-content')).toBeVisible();

      await expectNoHorizontalScroll(page);
    });
  }
});
