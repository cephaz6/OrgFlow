import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      include: ['src/**/*.ts'],
      // Barrel files re-export and contain no logic of their own; counting
      // them drags the number down without indicating anything untested.
      exclude: ['src/index.ts', 'src/**/*.test.ts'],
      // CLAUDE.md §7 definition of done: packages/core above 90%.
      // TECH-STACK.md §8 puts the target at 90%+ because this is pure
      // logic with no I/O, so there is no excuse for gaps.
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
    },
  },
});
