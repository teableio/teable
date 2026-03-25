/**
 * Specific eslint rules for this app/package, extends the base rules
 * @see https://github.com/teableio/teable/blob/main/docs/about-linters.md
 */

const { getDefaultIgnorePatterns } = require('@teable/eslint-config-bases/helpers');

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: 'tsconfig.json',
  },
  ignorePatterns: [...getDefaultIgnorePatterns(), '*.config.ts', '*.config.js', '.eslintrc.cjs'],
  extends: [
    '@teable/eslint-config-bases/typescript',
    // Apply prettier and disable incompatible rules
    '@teable/eslint-config-bases/prettier-plugin',
  ],
  rules: {
    '@typescript-eslint/naming-convention': 'off',
  },
  overrides: [
    // optional overrides per project file match
  ],
};
