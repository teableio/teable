const { getDefaultIgnorePatterns } = require('@teable/eslint-config-bases/helpers');

module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: {
    tsconfigRootDir: __dirname,
    project: 'tsconfig.json',
  },
  ignorePatterns: [...getDefaultIgnorePatterns(), '*.config.ts', '*.config.js', '.eslintrc.cjs'],
  extends: [
    '@teable/eslint-config-bases/typescript',
    '@teable/eslint-config-bases/prettier-plugin',
  ],
  rules: {
    '@typescript-eslint/naming-convention': 'off',
  },
};
