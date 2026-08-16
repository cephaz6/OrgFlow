import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

// The dependency graph from CLAUDE.md §3 and TECH-STACK.md §2:
//   types -> core -> db/documents/events -> api/workers
//   web -> types/ui only
// Expressed here as what each @orgflow/* package may import from other
// @orgflow/* packages. Anything not listed is forbidden.
const ALLOWED_ORGFLOW_IMPORTS = {
  types: [],
  core: ['types'],
  db: ['types', 'core'],
  documents: ['types', 'core'],
  events: ['types', 'core'],
  ui: ['types'],
  api: ['types', 'core', 'db', 'documents', 'events'],
  workers: ['types', 'core', 'db', 'documents', 'events'],
  web: ['types', 'ui'],
  infra: [],
};

const PACKAGE_DIR = {
  types: 'packages/types',
  core: 'packages/core',
  db: 'packages/db',
  documents: 'packages/documents',
  events: 'packages/events',
  ui: 'packages/ui',
  api: 'apps/api',
  workers: 'workers',
  web: 'apps/web',
  infra: 'infra',
};

const ORGFLOW_PACKAGES = Object.keys(ALLOWED_ORGFLOW_IMPORTS);

const dependencyDirectionConfigs = ORGFLOW_PACKAGES.map((name) => {
  const allowed = ALLOWED_ORGFLOW_IMPORTS[name];
  const allowedSet = new Set([name, ...allowed]);
  const forbidden = ORGFLOW_PACKAGES.filter((other) => !allowedSet.has(other));

  return {
    files: [`${PACKAGE_DIR[name]}/**/*.ts`, `${PACKAGE_DIR[name]}/**/*.tsx`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: forbidden.flatMap((other) => [`@orgflow/${other}`, `@orgflow/${other}/*`]),
              message: `@orgflow/${name} may only import from: ${
                allowed.length > 0 ? allowed.map((a) => `@orgflow/${a}`).join(', ') : 'nothing'
              }. See CLAUDE.md §3 (dependency direction).`,
            },
          ],
        },
      ],
    },
  };
});

// ADR-0001: process.env is read only inside an application's config module.
// Banned everywhere by default; the override below re-enables it in exactly
// those modules. No config module exists yet for any app; the paths here are
// the convention future steps build against.
const CONFIG_MODULE_GLOBS = [
  'apps/api/src/config/**/*.ts',
  'apps/web/src/config/**/*.ts',
  'workers/src/config/**/*.ts',
  'infra/src/config/**/*.ts',
];

// A separate concern from ADR-0001: test harness wiring (a Testcontainers
// global setup handing an ephemeral connection string to its test files)
// is not application runtime config, so it is exempted independently
// rather than folded into CONFIG_MODULE_GLOBS above.
const TEST_HARNESS_GLOBS = ['**/src/test/**/*.ts', '**/*.test.ts', '**/*.integration.test.ts'];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/cdk.out/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Express error-handling middleware requires all four parameters
      // (err, req, res, next) even when next is unused; underscore-prefix
      // is the convention for a deliberately unused parameter elsewhere too.
      //
      // ignoreRestSiblings covers the standard omit-by-destructuring idiom,
      // `const { _id, ...rest } = document`, where naming the discarded key
      // is the whole mechanism rather than an oversight.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Read process.env only inside an application config module, never elsewhere. See ADR-0001.',
        },
      ],
    },
  },
  {
    files: [...CONFIG_MODULE_GLOBS, ...TEST_HARNESS_GLOBS],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  ...dependencyDirectionConfigs,
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    plugins: {
      '@next/next': nextPlugin,
      'jsx-a11y': jsxA11y,
    },
    settings: {
      next: {
        rootDir: `${import.meta.dirname}/apps/web`,
      },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
    },
  },
  {
    files: ['apps/web/**/*.tsx'],
    ...reactHooks.configs.flat['recommended-latest'],
  },
);
