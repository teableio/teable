/**
 * Specific eslint rules for this app/package, extends the base rules
 * @see https://github.com/teable-group/taeble/blob/main/docs/about-linters.md
 */

// Workaround for https://github.com/eslint/eslint/issues/3458 (re-export of @rushstack/eslint-patch)
require('@teable-group/eslint-config-bases/patch/modern-module-resolution');

const {
  getDefaultIgnorePatterns,
} = require('@teable-group/eslint-config-bases/helpers');

module.exports = {
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: 'tsconfig.json',
  },
  ignorePatterns: [...getDefaultIgnorePatterns(), '.next', '.out'],
  extends: [
    '@teable-group/eslint-config-bases/typescript',
    '@teable-group/eslint-config-bases/sonar',
    '@teable-group/eslint-config-bases/regexp',
    '@teable-group/eslint-config-bases/jest',
    // Apply prettier and disable incompatible rules
    '@teable-group/eslint-config-bases/prettier',
  ],
  overrides: [
    // {
    //   files: ['server-src/*.{ts}'],
    //   rules: {
    //     '@typescript-eslint/consistent-type-imports': 'off',
    //   },
    // },
    {
      files: ['src/backend/**/*graphql*schema*.ts'],
      rules: {
        '@typescript-eslint/naming-convention': [
          'error',
          {
            // Fine-tune naming convention for graphql resolvers and allow PascalCase
            selector: ['objectLiteralProperty'],
            format: ['camelCase', 'PascalCase'],
          },
        ],
      },
    },
  ],
};
