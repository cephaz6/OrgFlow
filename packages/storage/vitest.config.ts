import { defineConfig } from 'vitest/config';

// Integration tests need the LocalStack container and run under
// vitest.integration.config.ts; the default run stays infrastructure-free.
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
