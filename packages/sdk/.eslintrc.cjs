/**
 * Specific eslint rules for this app/package, extends the base rules
 * @see https://github.com/teable-group/teable/blob/main/docs/about-linters.md
 */

// Workaround for https://github.com/eslint/eslint/issues/3458 (re-export of @rushstack/eslint-patch)
require('@teable-group/eslint-config-bases/patch/modern-module-resolution');

const { getDefaultIgnorePatterns } = require('@teable-group/eslint-config-bases/helpers');

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: 'tsconfig.eslint.json',
  },
  ignorePatterns: [...getDefaultIgnorePatterns()],
  extends: [
    '@teable-group/eslint-config-bases/typescript',
    '@teable-group/eslint-config-bases/sonar',
    '@teable-group/eslint-config-bases/regexp',
    '@teable-group/eslint-config-bases/jest',
    '@teable-group/eslint-config-bases/rtl',
    '@teable-group/eslint-config-bases/react',
    '@teable-group/eslint-config-bases/tailwind',
    // Apply prettier and disable incompatible rules
    '@teable-group/eslint-config-bases/prettier-plugin',
  ],
  rules: {
    // optional overrides per project file match
  },
  overrides: [
    {
      files: ['src/components/**', 'src/context/**'],
      rules: {
        '@typescript-eslint/naming-convention': 'off',
      },
    },
  ],
};
