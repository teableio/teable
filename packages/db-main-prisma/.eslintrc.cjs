/**
 * Specific eslint rules for this app/package, extends the base rules
 * @see https://github.com/teableio/teable/blob/main/docs/about-linters.md
 */

// Workaround for https://github.com/eslint/eslint/issues/3458 (re-export of @rushstack/eslint-patch)
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
    // Apply prettier and disable incompatible rules
    '@teable/eslint-config-bases/prettier-plugin',
  ],
  rules: {
    // optional overrides per project
  },
  overrides: [
    // optional overrides per project file match
  ],
};
