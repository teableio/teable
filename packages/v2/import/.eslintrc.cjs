/**
 * Specific eslint rules for this workspace, learn how to compose
 * @link https://github.com/teableio/teable/tree/main/packages/eslint-config-bases
 */
require('@teable/eslint-config-bases/patch/modern-module-resolution');

const { getDefaultIgnorePatterns } = require('@teable/eslint-config-bases/helpers');

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: 'tsconfig.eslint.json',
  },
  ignorePatterns: [...getDefaultIgnorePatterns()],
  extends: [
    '@teable/eslint-config-bases/typescript',
    '@teable/eslint-config-bases/sonar',
    '@teable/eslint-config-bases/regexp',
    '@teable/eslint-config-bases/jest',
    // SSRF guardrail: the adapters' URL fetches go through the process-wide
    // safeFetch (@teable/v2-utils); this catches any new raw clients.
    '@teable/eslint-config-bases/no-ssrf',
    // Apply prettier and disable incompatible rules
    '@teable/eslint-config-bases/prettier-plugin',
  ],
  rules: {
    // This package was previously unlinted (no eslintrc); first-time linting
    // surfaces pre-existing debt unrelated to SSRF. Keep these as warnings so
    // the no-ssrf guardrail lands CI-green; tighten in a follow-up.
    'import/order': 'warn',
    'sonarjs/cognitive-complexity': 'warn',
    'sonarjs/no-duplicate-string': 'warn',
  },
  overrides: [],
};
