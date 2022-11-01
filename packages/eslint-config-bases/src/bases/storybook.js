/**
 * Opinionated config base for projects using storybook.
 * @see https://github.com/belgattitude/nextjs-monorepo-example/tree/main/packages/eslint-config-bases
 */

const storybookPatterns = {
  files: ['**/*.stories.{ts,tsx,mdx}'],
};

module.exports = {
  env: {
    browser: true,
    es6: true,
    node: true,
  },
  overrides: [
    {
      // For performance run storybook/recommended on test files, not regular code
      files: storybookPatterns.files,
      extends: ['plugin:storybook/recommended'],
    },
  ],
};
