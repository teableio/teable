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
  ignorePatterns: [...getDefaultIgnorePatterns(), 'src/formula/parser', 'src/query/parser'],
  extends: [
    '@teable/eslint-config-bases/typescript',
    '@teable/eslint-config-bases/sonar',
    '@teable/eslint-config-bases/regexp',
    '@teable/eslint-config-bases/jest',
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
