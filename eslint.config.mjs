import nx from '@nx/eslint-plugin';

// Enforces the layering from docs/Action Plan.md §1/§6: domain-* packages are
// framework-agnostic and must never import Nest/Express/HTTP/auth code, so a
// future Local/Electron adaptation of the domain layer stays a bounded effort
// instead of a rewrite. infra-db may depend on domain (to implement its
// repository interfaces); the reverse is not allowed.
export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist', '**/vite.config.*.timestamp*', '**/vitest.config.*.timestamp*'],
  },
  {
    // enforce-module-boundaries only constrains cross-project (workspace) imports.
    // domain-* leaking framework code happens via *external* packages (@nestjs/*,
    // express, ...), which no-restricted-imports has to catch instead.
    files: ['packages/domain-*/**/*.ts', 'packages/domain-*/**/*.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@nestjs/*'], message: 'domain-* packages must stay framework-agnostic — see docs/Action Plan.md §6.' },
            { group: ['express', 'express-*'], message: 'domain-* packages must stay framework-agnostic — see docs/Action Plan.md §6.' },
            { group: ['@org/api', '@org/web'], message: 'domain-* packages must not depend on apps — see docs/Action Plan.md §1/§6.' },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'scope:domain',
              onlyDependOnLibsWithTags: ['scope:domain', 'scope:shared'],
            },
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:infra',
              onlyDependOnLibsWithTags: ['scope:infra', 'scope:domain', 'scope:shared'],
            },
            {
              sourceTag: 'scope:api',
              onlyDependOnLibsWithTags: ['scope:api', 'scope:domain', 'scope:shared', 'scope:infra'],
            },
            {
              sourceTag: 'scope:web',
              onlyDependOnLibsWithTags: ['scope:web', 'scope:shared'],
            },
          ],
        },
      ],
    },
  },
];
