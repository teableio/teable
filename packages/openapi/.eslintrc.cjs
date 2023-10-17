/**
 * Specific eslint rules for this workspace, learn how to compose
 * @link https://github.com/teable-group/teable/tree/main/packages/eslint-config-bases
 */

const { getDefaultIgnorePatterns } = require('@teable-group/eslint-config-bases/helpers');

module.exports = {
  root: true,
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: 'tsconfig.json',
  },
  ignorePatterns: [...getDefaultIgnorePatterns()],
  extends: [
    '@teable-group/eslint-config-bases/typescript',
    '@teable-group/eslint-config-bases/prettier-plugin',
  ],
  rules: {
    // optional overrides per project
    '@typescript-eslint/naming-convention': 'off',
  },
  overrides: [
    // optional overrides per project file match
  ],
};
