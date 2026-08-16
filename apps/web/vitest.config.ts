import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright owns e2e/, and vitest's default glob would collect those
    // specs too. Both runners export a `test` symbol, so the collision does
    // not surface as "wrong runner" but as a misleading complaint about two
    // versions of @playwright/test being installed.
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**', '**/.next/**'],
  },
});
