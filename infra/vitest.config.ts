import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // test/stacks.test.ts does a real cdk synth plus a full cdk-nag pass
    // per stack; that legitimately takes 60-90s, well over vitest's 5s
    // default.
    testTimeout: 120_000,
  },
});
