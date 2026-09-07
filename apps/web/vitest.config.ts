import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Playwright owns e2e/, and vitest's default glob would collect those
    // specs too. Both runners export a `test` symbol, so the collision does
    // not surface as "wrong runner" but as a misleading complaint about two
    // versions of @playwright/test being installed.
    exclude: ['e2e/**', '**/node_modules/**', '**/dist/**', '**/.next/**'],
    // src/config/env.ts validates the environment at import time and throws
    // if it is absent (ADR-0001), so any test touching a module that reaches
    // the API client fails on import rather than on an assertion. Several
    // modules were split in two to avoid exactly that; api-client.test.ts
    // tests the client itself, so it needs the variable instead. The value
    // is never dialled: every test stubs fetch.
    env: {
      NEXT_PUBLIC_ORGFLOW_API_URL: 'http://localhost:4000/api/v1',
    },
  },
});
