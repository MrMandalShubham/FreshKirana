/**
 * Module boundary enforcement — spec §2.1.1, standing rule R2.
 *
 * These rules are what make §2.1.2 service extraction cheap later. Disabling
 * one to "unblock" work is a violation of rule R2: fix the import instead.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment:
        'A module may only be reached through its contracts.ts. Importing another ' +
        "module's internal/ or schema.ts couples you to its private structure and " +
        'blocks extraction (§2.1.1).',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/(internal|schema)',
        pathNot: '^src/modules/$1/',
      },
    },
    {
      name: 'no-app-reaching-into-modules',
      severity: 'error',
      comment:
        'Application-level code composes modules; it must not reach past contracts.ts.',
      from: { path: '^src/(?!modules/)' },
      to: { path: '^src/modules/[^/]+/(internal|schema)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies between modules mean the boundary is wrong. Move the ' +
        'shared concept into @freshkirana/contracts or a lower-level module (§2.1.1).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      severity: 'warn',
      comment: 'Unreachable file — dead code or a missing wire-up.',
      from: {
        orphan: true,
        pathNot: [
          '[.]d[.]ts$',
          '(^|/)[.][^/]+[.](js|cjs|mjs|ts|json)$',
          '(^|/)tsconfig[.]json$',
          '(^|/)(vitest|drizzle)[.]config[.]ts$',
          '^src/modules/[^/]+/(contracts|schema)[.]ts$',
          '^src/modules/registry[.]ts$',
        ],
      },
      to: {},
    },
  ],

  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)dist/|[.]spec[.]ts$' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['require', 'node', 'default'],
      extensions: ['.ts', '.js', '.json'],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
