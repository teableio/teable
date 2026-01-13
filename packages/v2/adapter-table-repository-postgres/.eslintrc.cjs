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
  ignorePatterns: [...getDefaultIgnorePatterns(), '.eslintrc.cjs'],
  extends: [
    '@teable/eslint-config-bases/typescript',
    '@teable/eslint-config-bases/regexp',
    '@teable/eslint-config-bases/jest',
    // Apply prettier and disable incompatible rules
    '@teable/eslint-config-bases/prettier-plugin',
  ],
  overrides: [
    {
      files: ['**/*.spec.ts', '**/*.test.ts', '**/__tests__/**/*.ts'],
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-empty-function': 'off',
      },
    },
  ],
  rules: {
    '@typescript-eslint/naming-convention': 'off',
    '@typescript-eslint/no-this-alias': 'off',
    'no-console': 'error',
  },
};
