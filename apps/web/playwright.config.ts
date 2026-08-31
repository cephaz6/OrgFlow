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
  // members.spec.ts's role editor and invitations.spec.ts's accept flow
  // both mutate the seeded manager account's roles: it is the only second
  // identity dev-login offers, so both files are forced to share it for
  // anything that edits somebody else's membership. Run against each other
  // at full parallelism, the two files raced their PATCH calls
  // last-write-wins (observed directly: invitations.spec.ts's post-accept
  // assertion failing because members.spec.ts's own write landed in
  // between). A per-project workers cap is Playwright's own documented
  // mechanism for exactly this, "tests from a project share a single
  // resource like a test account": everything else keeps full parallelism
  // in the default project, and only these files, which share the manager
  // account's mutable state, are limited to one worker so they can never
  // overlap.
  //
  // notification-preferences.spec.ts joins this project for the same
  // reason: it disables and restores the manager's own notification
  // channels, and notifications.spec.ts (in the project below) asserts the
  // manager actually receives one. Left in full parallelism, the two could
  // interleave exactly like members.spec.ts and invitations.spec.ts once
  // did.
  projects: [
    {
      name: 'shared-manager-account',
      testMatch: ['members.spec.ts', 'invitations.spec.ts', 'notification-preferences.spec.ts'],
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Depends on the project above rather than merely running alongside
      // it: approvals.spec.ts and dashboard.spec.ts sign in as the same
      // manager account and read its Approver role, and notifications.spec.ts
      // depends on its notification channels being enabled, so none of them
      // must run while that state is mid-mutation either, not only avoid
      // mutating it themselves. `dependencies` blocks this project from
      // starting until shared-manager-account has fully finished and every
      // test in it has restored the account to its seeded state.
      name: 'chromium',
      testIgnore: ['members.spec.ts', 'invitations.spec.ts', 'notification-preferences.spec.ts'],
      dependencies: ['shared-manager-account'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // ORGFLOW_E2E_BASE_URL points the suite at an already-built server on
  // another port. Worth knowing why that option exists: a long-lived `next
  // dev` process can end up serving an empty stylesheet after globals.css is
  // rewritten underneath it, and axe on an unstyled page reports no contrast
  // violations because there are no colours to check. A green run against a
  // stale dev server is the one failure mode this suite cannot detect about
  // itself, so the trustworthy run is the one against a real build.
  webServer: {
    // CI always gets the real build (see the comment above): a freshly
    // provisioned runner has no long-lived dev server to reuse in any case,
    // so there is no cost to always building there, only upside.
    command: process.env.CI ? 'pnpm run start' : 'pnpm run dev',
    url: process.env.ORGFLOW_E2E_BASE_URL ?? 'http://localhost:3000',
    // The operator keeps the dev servers running between steps in order to
    // trace live state, so an existing server is the normal case locally
    // and a stale one is the failure mode to avoid in CI.
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
