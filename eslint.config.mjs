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
  // No @orgflow dependency of its own: a third-party integration behind an
  // interface (ADR-0008's 3pservice pattern), the same shape as db,
  // documents and events, consumed by both api (invitation delivery) and
  // workers (notification delivery) so the transport cannot diverge between
  // them.
  email: [],
  // No @orgflow dependency of its own, same reasoning and shape as email:
  // a third-party integration (S3) behind an interface, consumed by both
  // api (presigning) and workers (the scan Lambda's object reads/moves).
  storage: [],
  ui: ['types'],
  api: ['types', 'core', 'db', 'documents', 'events', 'email', 'storage'],
  workers: ['types', 'core', 'db', 'documents', 'events', 'email', 'storage'],
  // ADR-0018: core is included deliberately. The rule's purpose is that web
  // never imports server code, and packages/core is not server code: it
  // performs no I/O by mandate (CLAUDE.md §3), so it is isomorphic. The form
  // runtime evaluates the same visibleWhen conditions the engine does, and a
  // second implementation in the browser could disagree with it.
  web: ['types', 'core', 'ui'],
  infra: [],
};

const PACKAGE_DIR = {
  types: 'packages/types',
  core: 'packages/core',
  db: 'packages/db',
  documents: 'packages/documents',
  events: 'packages/events',
  email: 'packages/email',
  storage: 'packages/storage',
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
const TEST_HARNESS_GLOBS = [
  '**/src/test/**/*.ts',
  '**/*.test.ts',
  '**/*.integration.test.ts',
  // Playwright's runner and its specs are harness wiring for the same
  // reason the Testcontainers setup above is: they choose a base URL and a
  // reporter from the environment, which is not application runtime config.
  '**/playwright.config.ts',
  '**/e2e/**/*.ts',
];

const PROCESS_ENV_RULE = {
  selector: "MemberExpression[object.name='process'][property.name='env']",
  message:
    'Read process.env only inside an application config module, never elsewhere. See ADR-0001.',
};

// CLAUDE.md §5.3 says raw colour values outside the token file are "a
// defect, and this is enforced by lint rather than by review". This is that
// enforcement. It was previously unenforced, which is why the rule is
// arriving alongside the first substantial batch of components rather than
// after them.
//
// Both string literals and template chunks are matched, because
// cn(`bg-blue-500`) is as much a violation as className="bg-blue-500", and
// only checking Literal would leave the template form as an easy accident.
const RAW_COLOUR_PATTERNS = [
  {
    pattern: '#[0-9a-fA-F]{3}',
    message:
      'No raw hex colours in components (CLAUDE.md §5.3). Use a semantic token such as bg-card or text-muted-foreground; raw values belong only in packages/ui/src/tokens.css.',
  },
  {
    pattern: '(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\\(',
    message:
      'No raw colour functions in components (CLAUDE.md §5.3). Use a semantic token; raw values belong only in packages/ui/src/tokens.css.',
  },
  {
    pattern:
      '(?:bg|text|border|ring|from|via|to|fill|stroke|outline|decoration|shadow|accent|caret|divide|placeholder)-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-[0-9]{2,3}',
    message:
      'No direct Tailwind palette colours in components (CLAUDE.md §5.3). Use a semantic token such as bg-primary, text-muted-foreground or border-destructive.',
  },
  {
    pattern: '(?:bg|text|border|ring|fill|stroke|divide|placeholder)-(?:white|black)',
    message:
      'No absolute white or black in components (CLAUDE.md §5.3). Use a semantic token such as bg-card or text-foreground, so a theme swap reaches this colour too.',
  },
];

const rawColourRules = RAW_COLOUR_PATTERNS.flatMap(({ pattern, message }) => [
  { selector: `Literal[value=/${pattern}/]`, message },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message },
]);

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
      'no-restricted-syntax': ['error', PROCESS_ENV_RULE],
    },
  },
  {
    // no-restricted-syntax takes one options array, and a later block
    // replaces the earlier one rather than adding to it, so the colour
    // selectors have to carry PROCESS_ENV_RULE along with them. Dropping it
    // here would silently exempt every component from ADR-0001.
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx', 'packages/ui/**/*.ts', 'packages/ui/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', PROCESS_ENV_RULE, ...rawColourRules],
    },
  },
  {
    // Must stay after both blocks above: this is the exemption, and an
    // exemption that runs first exempts nothing.
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
