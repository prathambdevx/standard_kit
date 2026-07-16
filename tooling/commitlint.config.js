/**
 * Commitlint configuration — Conventional Commits.
 * See: https://www.conventionalcommits.org
 *
 * Enforced by lefthook's `commit-msg` hook on every commit.
 *
 * @type {import('@commitlint/types').UserConfig}
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'refactor', 'perf', 'docs', 'test', 'chore', 'ci', 'build', 'revert'],
    ],
    // Monorepo Model A — scope is the PLATFORM (the app/package changed).
    // apps/* → bff | web | mobile · packages/* → types | cart | api-sdk
    // cross-cutting → infra | deps | ci | tooling | docs | release | root
    // Multi-platform (ripple) commits list comma-separated scopes:
    // `feat(types,web,mobile): ...` — commitlint validates each segment.
    'scope-enum': [
      2,
      'always',
      [
        // apps
        'bff',
        'web',
        'mobile',
        'cms',
        'admin-ui',
        // packages
        'types',
        'cart',
        'api-sdk',
        'commerce',
        // cross-cutting
        'infra',
        'deps',
        'ci',
        'tooling',
        'docs',
        'release',
        'root',
      ],
    ],
    // Scope (platform) is mandatory on every commit in the monorepo.
    'scope-empty': [2, 'never'],
    'subject-case': [2, 'never', ['start-case', 'pascal-case', 'upper-case']],
    'subject-empty': [2, 'never'],
    'subject-full-stop': [2, 'never', '.'],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 120],
  },
};
