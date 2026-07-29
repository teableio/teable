/**
 * Custom config base for projects using jest.
 * @see https://github.com/teableio/teable/tree/main/packages/eslint-config-bases
 */

const jestPatterns = {
  files: ['**/?(*.)+(spec|test).{js,jsx,ts,tsx}'],
  strictFiles: ['**/?(*.)+(test).{js,jsx,ts,tsx}'],
};

module.exports = {
  env: {
    es6: true,
    node: true,
  },
  settings: {
    // To prevent autodetection issues in monorepos or via vitest
    jest: {
      version: 'latest',
    },
  },
  overrides: [
    {
      // Keep high-signal safeguards and relaxed TypeScript rules for all test conventions.
      files: jestPatterns.files,
      plugins: ['jest'],
      rules: {
        'import/namespace': 'off',
        'import/default': 'off',
        'import/no-duplicates': 'off',
        'import/no-named-as-default-member': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
        '@typescript-eslint/no-object-literal-type-assertion': 'off',
        '@typescript-eslint/no-empty-function': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/ban-ts-comment': 'off',
        '@typescript-eslint/no-unsafe-member-access': 'off',
        '@typescript-eslint/no-unsafe-assignment': 'off',
        'jest/no-focused-tests': 'error',
      },
    },
    {
      // Preserve the existing stricter profile for *.test.* files.
      files: jestPatterns.strictFiles,
      // @see https://github.com/jest-community/eslint-plugin-jest
      extends: ['plugin:jest/recommended'],
      rules: {
        'jest/no-focused-tests': 'error',
        'jest/prefer-mock-promise-shorthand': 'error',
        'jest/no-commented-out-tests': 'error',
        'jest/prefer-hooks-in-order': 'error',
        'jest/prefer-hooks-on-top': 'error',
        'jest/no-conditional-in-test': 'error',
        'jest/no-duplicate-hooks': 'error',
        'jest/no-test-return-statement': 'error',
        'jest/prefer-strict-equal': 'error',
        'jest/prefer-to-have-length': 'error',
        'jest/consistent-test-it': ['error', { fn: 'it' }],
        // https://github.com/jest-community/eslint-plugin-jest/blob/main/docs/rules/unbound-method.md
        '@typescript-eslint/unbound-method': 'off',
        'jest/unbound-method': 'error',
      },
    },
  ],
};
