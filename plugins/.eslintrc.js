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
    project: './tsconfig.json',
  },
  ignorePatterns: [...getDefaultIgnorePatterns(), '.eslintrc.js', '*.config.js', '*.config.mjs', 'scripts/*'],
  extends: [
    '@teable/eslint-config-bases/typescript',
    '@teable/eslint-config-bases/sonar',
    '@teable/eslint-config-bases/regexp',
    '@teable/eslint-config-bases/jest',
    '@teable/eslint-config-bases/react',
    '@teable/eslint-config-bases/tailwind',
    '@teable/eslint-config-bases/rtl',
    // Add specific rules for nextjs
    'plugin:@next/next/core-web-vitals',
    // Apply prettier and disable incompatible rules
    '@teable/eslint-config-bases/prettier-plugin',
  ],
  rules: {
    '@typescript-eslint/naming-convention': 'off',
    // https://github.com/vercel/next.js/discussions/16832
    '@next/next/no-img-element': 'off',
    // For the sake of example
    // https://github.com/jsx-eslint/eslint-plugin-jsx-a11y/blob/HEAD/docs/rules/anchor-is-valid.md
    'jsx-a11y/anchor-is-valid': 'off',
    'jsx-a11y/label-has-associated-control': 'off',
  },
  overrides: [
    {
      files: ['src/\\_*.{ts,tsx}'],
      rules: {
        'react/display-name': 'off',
      },
    },
    {
      files: ['**/*.{spec,test}.{ts,tsx}'],
      rules: {
        'react/display-name': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        'jsx-a11y/click-events-have-key-events': 'off',
        'jsx-a11y/no-static-element-interactions': 'off',
      },
    },
  ],
};
