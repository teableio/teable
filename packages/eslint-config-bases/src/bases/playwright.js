/**
 * Opinionated config base for projects using playwright.
 * @see https://github.com/belgattitude/nextjs-monorepo-example/tree/main/packages/eslint-config-bases
 */

const playwrightPatterns = {
  files: ['**/e2e/**/*.test.{js,ts}'],
};

module.exports = {
  overrides: [
    {
      // To ensure best performance enable only on e2e test files
      files: playwrightPatterns.files,
      // @see https://github.com/playwright-community/eslint-plugin-playwright
      extends: ['plugin:playwright/recommended'],
      rules: {
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-object-literal-type-assertion': 'off',
        '@typescript-eslint/no-empty-function': 'off',
      },
    },
  ],
};
