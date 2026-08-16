import { expect, test, type Page } from '@playwright/test';

import { expectNoAccessibilityViolations, signIn } from './support';

// The page background each palette resolves to, exactly as tokens.css
// declares it. Asserted as a rendered computed value rather than by the
// data-theme attribute alone: the attribute proves what was requested,
// this proves the palette actually applied.
const DARK_BACKGROUND = 'oklch(0.16 0.006 285)';
const LIGHT_BACKGROUND = 'oklch(0.97 0.003 285)';

function bodyBackground(page: Page): Promise<string> {
  return page.locator('body').evaluate((el) => getComputedStyle(el).backgroundColor);
}

async function chooseTheme(page: Page, name: 'Light' | 'Dark' | 'Match device') {
  await page.getByRole('button', { name: 'Theme' }).click();
  await page.getByRole('menuitemradio', { name }).click();
}

// "No explicit choice" is not one behaviour, it is two: follow the device.
// Both directions are exercised, because a palette that only ever gets
// tested on a light-preferring runner (Playwright's own default) would
// leave the dark default entirely unverified.
test.describe('theme follows the device when nothing is chosen', () => {
  test.describe('on a dark-preferring device', () => {
    test.use({ colorScheme: 'dark' });

    test('renders dark with no data-theme attribute', async ({ page }) => {
      await signIn(page);
      await page.goto('/');
      await expect(page.locator('html')).not.toHaveAttribute('data-theme');
      expect(await bodyBackground(page)).toBe(DARK_BACKGROUND);
    });
  });

  test.describe('on a light-preferring device', () => {
    test.use({ colorScheme: 'light' });

    test('renders light with no data-theme attribute', async ({ page }) => {
      await signIn(page);
      await page.goto('/');
      await expect(page.locator('html')).not.toHaveAttribute('data-theme');
      expect(await bodyBackground(page)).toBe(LIGHT_BACKGROUND);
    });
  });
});

test.describe('theme', () => {
  // A dark-preferring device throughout, so an explicit light choice is
  // genuinely overriding the system rather than agreeing with it.
  test.use({ colorScheme: 'dark' });

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('an explicit choice overrides the device preference', async ({ page }) => {
    await page.goto('/');
    expect(await bodyBackground(page)).toBe(DARK_BACKGROUND);

    await chooseTheme(page, 'Light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await bodyBackground(page)).toBe(LIGHT_BACKGROUND);
  });

  test('applies a stored choice before React hydrates, not after', async ({ page }) => {
    await page.goto('/');
    await chooseTheme(page, 'Light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // The point of theme-script.tsx is that the theme is right before the
    // first paint, so there is no flash of the wrong palette. Asserting
    // the attribute after a normal reload cannot prove that: React would
    // produce the same end state a moment later even if the script were
    // deleted.
    //
    // Blocking Next's client bundles is what makes it a real test. React
    // never loads, so nothing can hydrate or run an effect; the only thing
    // left that could have set the attribute is the inline script in
    // <head>. If this passes, there is no flash.
    await page.route('**/_next/static/chunks/**', (route) => route.abort());
    await page.reload();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await bodyBackground(page)).toBe(LIGHT_BACKGROUND);
  });

  test('returning to "match device" forgets the explicit choice', async ({ page }) => {
    await page.goto('/');
    await chooseTheme(page, 'Light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await chooseTheme(page, 'Match device');
    // The attribute is removed rather than set to "system": only its
    // absence lets tokens.css's prefers-color-scheme block apply, so a
    // later change of device preference is actually followed.
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    expect(await bodyBackground(page)).toBe(DARK_BACKGROUND);

    await page.reload();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  });

  test('marks the active theme for assistive technology, not by tick alone', async ({ page }) => {
    await page.goto('/');
    await chooseTheme(page, 'Dark');

    await page.getByRole('button', { name: 'Theme' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Dark' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  test('has no accessibility violations in light theme', async ({ page }) => {
    await page.goto('/');
    await chooseTheme(page, 'Light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectNoAccessibilityViolations(page);
  });

  test('has no accessibility violations on a data-heavy page in light theme', async ({ page }) => {
    // The dashboard is mostly empty state. The approvals queue carries the
    // status badges, urgency tones and table chrome that actually exercise
    // the palette's subtle tiers.
    await page.goto('/approvals');
    await chooseTheme(page, 'Light');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectNoAccessibilityViolations(page);
  });

  test('settings offers the same choice, and it agrees with the header', async ({ page }) => {
    await page.goto('/settings');
    await page.getByRole('radio', { name: /Light/ }).check();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expectNoAccessibilityViolations(page);

    // The two controls are separate components reading one provider, so
    // this is what catches them drifting into separate state.
    await page.getByRole('button', { name: 'Theme' }).click();
    await expect(page.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});

test.describe('account menu', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test('shows who is signed in, and reaches profile', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Account:/ }).click();

    const menu = page.getByRole('menu');
    await expect(menu).toContainText('Local Dev User');
    await expect(menu).toContainText('dev@orgflow.local');

    await page.getByRole('menuitem', { name: 'Profile' }).click();
    await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible();
    // Real content from the session, not a placeholder page.
    await expect(page.getByText('dev@orgflow.local')).toBeVisible();

    await expectNoAccessibilityViolations(page);
  });

  test('opens and closes by keyboard alone, returning focus', async ({ page }) => {
    await page.goto('/');

    const trigger = page.getByRole('button', { name: /Account:/ });
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
    // Focus returns to the trigger rather than being dropped to the body,
    // which is what makes the menu usable without a pointer.
    await expect(trigger).toBeFocused();
  });

  test('signs out', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Account:/ }).click();
    await page.getByRole('menuitem', { name: /Sign out/ }).click();

    await page.waitForURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to OrgFlow' })).toBeVisible();
  });
});
