/**
 * Opinionated config base for projects using react.
 * @see https://github.com/belgattitude/nextjs-monorepo-example/tree/main/packages/eslint-config-bases
 */

const reactPatterns = {
  files: ['*.{jsx,tsx}'],
};

/**
 * Fine-tune naming convention react typescript jsx (function components)
 * @link https://github.com/typescript-eslint/typescript-eslint/blob/main/packages/eslint-plugin/docs/rules/naming-convention.md
 */

module.exports = {
  overrides: [
    {
      files: [...reactPatterns.files],
      extends: [
        // @see https://tanstack.com/query/v4/docs/react/eslint/eslint-plugin-query
        'plugin:@tanstack/eslint-plugin-query/recommended',
      ],
      // rules: { },
    },
  ],
};
