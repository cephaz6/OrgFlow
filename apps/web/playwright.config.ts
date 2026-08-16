import { defineConfig, devices } from '@playwright/test';

// TECH-STACK.md §8 puts full journeys and accessibility checks on Playwright
// with @axe-core/playwright. axe needs a real browser: the violations that
// matter here (contrast, focus order, name-role-value on a native <dialog>)
// are properties of rendered, styled, laid-out pages, and a jsdom render
// cannot see any of them.
//
// These specs run against the whole stack, not against apps/web alone. Even
// /login calls the API, because the page asks whether there is already a
// session before it renders a form. So Postgres, Mongo, the API and the web
// server all have to be up: `pnpm run docker:up && pnpm run dev`.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.ORGFLOW_E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // ORGFLOW_E2E_BASE_URL points the suite at an already-built server on
  // another port. Worth knowing why that option exists: a long-lived `next
  // dev` process can end up serving an empty stylesheet after globals.css is
  // rewritten underneath it, and axe on an unstyled page reports no contrast
  // violations because there are no colours to check. A green run against a
  // stale dev server is the one failure mode this suite cannot detect about
  // itself, so the trustworthy run is the one against a real build.
  webServer: {
    command: 'pnpm run dev',
    url: process.env.ORGFLOW_E2E_BASE_URL ?? 'http://localhost:3000',
    // The operator keeps the dev servers running between steps in order to
    // trace live state, so an existing server is the normal case locally
    // and a stale one is the failure mode to avoid in CI.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
