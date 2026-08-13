import js from '@eslint/js';
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
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/cdk.out/**',
      '**/coverage/**',
      '**/node_modules/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {},
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
    files: CONFIG_MODULE_GLOBS,
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
  ...dependencyDirectionConfigs,
);
