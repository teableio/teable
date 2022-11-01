/**
 * Custom config base for projects that wants to enable regexp rules.
 * @see https://github.com/belgattitude/nextjs-monorepo-example/tree/main/packages/eslint-config-bases
 */

const regexpPatterns = {
  files: ['*.{js,jsx,jsx,tsx}'],
};

module.exports = {
  // @see https://github.com/ota-meshi/eslint-plugin-regexp
  extends: ['plugin:regexp/recommended'],
  overrides: [
    {
      // To ensure best performance enable only on e2e test files
      files: regexpPatterns.files,
      extends: ['plugin:regexp/recommended'],
      rules: {
        'regexp/prefer-result-array-groups': 'off',
      },
    },
  ],
};
