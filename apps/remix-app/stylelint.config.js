/**
 * @link https://stylelint.io/user-guide/rules/list/
 */
module.exports = {
  extends: ['stylelint-config-standard', 'stylelint-config-prettier'],
  rules: {
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: ['tailwind'],
      },
    ],
    // 'color-function-notation': null,
    // 'value-keyword-case': null,
    'selector-class-pattern': null,
  },
};
