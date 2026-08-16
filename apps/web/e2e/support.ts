import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

// The same base the browser uses, version prefix included: the API mounts
// every route under /api/v1, and only /health sits outside it.
const API_URL = process.env.NEXT_PUBLIC_ORGFLOW_API_URL ?? 'http://localhost:4000/api/v1';

// WCAG 2.2 AA, which CLAUDE.md §3 makes a completion criterion rather than a
// follow-up ticket. The earlier tag sets are included because 2.2 AA is
// cumulative: it contains 2.1 AA, which contains 2.0 AA.
const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

export async function expectNoAccessibilityViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_22_AA_TAGS]).analyze();

  // A page served without its stylesheet has no colours to compare, so axe
  // reports no contrast violations and the whole suite goes green while
  // checking nothing. That is not hypothetical: it happened here, when a
  // production build overwrote the .next directory a dev server was running
  // from. Asserting that the contrast rule was actually exercised is what
  // distinguishes "no violations" from "nothing examined".
  const contrastWasEvaluated = [
    ...results.passes,
    ...results.violations,
    ...results.incomplete,
  ].some((result) => result.id === 'color-contrast');
  expect(
    contrastWasEvaluated,
    'axe did not evaluate colour contrast, so this page is unstyled',
  ).toBe(true);

  // Mapped rather than asserted raw: a bare toEqual([]) prints the whole
  // axe node tree, which buries the rule that actually failed.
  expect(
    results.violations.map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map((node) => node.target.join(' ')),
    })),
  ).toEqual([]);
}

// The seeded local development path (ADR-0010). The cookie is set by the API
// on localhost:4000, and cookies are scoped by host without regard to port,
// so the web application on localhost:3000 receives the same session. That
// is exactly how the browser behaves for a real developer, which is the
// point of signing in this way rather than forging a cookie.
export async function signIn(page: Page): Promise<void> {
  const response = await page.request.post(`${API_URL}/auth/dev-login`);
  expect(response.ok(), 'the seeded development login must be available').toBe(true);
}

// The seeded line manager, who is who the Laptop Request's first step
// assigns to. An approval needs two people by definition, so without this
// the approve, reject and return paths could only ever be exercised through
// forged session tokens in the API tests, never through the screens.
export async function signInAsManager(page: Page): Promise<void> {
  const response = await page.request.post(`${API_URL}/auth/dev-login`, {
    data: { as: 'manager' },
  });
  expect(response.ok(), 'the seeded manager login must be available').toBe(true);
}
