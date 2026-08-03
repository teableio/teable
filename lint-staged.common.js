// @ts-check

const path = require('path');
const escape = require('shell-quote').quote;

const isWin = process.platform === 'win32';

const eslintGlobalRulesForFix = [
  // react-hooks/eslint and react in general is very strict about exhaustively
  // declaring the dependencies when using the useEffect, useCallback... hooks.
  //
  // In some specific scenarios declaring the deps seems 'less' wanted or 'less' applicable
  // by the developer, leading to some exceptions in the code. That said it should be avoided.
  //
  // While the 'react-hooks/exhaustive-deps' rule is a good rule of thumb, it's not recommended to
  // automatically fix it from lint-staged as it can potentially break a legit intent.
  //
  // Reminder that a good practice is to always declare the dependencies when using the hooks,
  // and if not applicable, add an eslint disable comment to the useEffect, useCallback... such as:
  //
  //    // eslint-disable-next-line react-hooks/exhaustive-deps
  //
  // Another approach can be to use hooks such as https://github.com/kentcdodds/use-deep-compare-effect to quickly bypass
  // shallow rendering limitations.
  //
  // @see https://reactjs.org/docs/hooks-rules.html
  // @see https://eslint.org/docs/2.13.1/user-guide/configuring#disabling-rules-with-inline-comments
  'react-hooks/exhaustive-deps: off',
];

/**
 * Lint-staged command for running eslint in packages or apps.
 * @param {{cwd: string, files: string[], fix: boolean, fixType?: ('problem'|'suggestion'|'layout'|'directive')[], cache: boolean, rules?: string[], maxWarnings?: number}} params
 */
const getEslintFixCmd = ({
  cwd,
  files,
  rules,
  fix,
  fixType,
  cache,
  maxWarnings,
}) => {
  const cliRules = [...(rules ?? []), ...eslintGlobalRulesForFix]
    .filter((rule) => rule.trim().length > 0)
    .map((r) => `"${r.trim()}"`);

  // For lint-staged it's safer to not apply the fix command if it changes the AST
  // @see https://eslint.org/docs/user-guide/command-line-interface#--fix-type
  const cliFixType = [...(fixType ?? ['layout'])].filter(
    (type) => type.trim().length > 0
  );

  const args = [
    cache ? '--cache' : '',
    fix ? '--fix' : '',
    cliFixType.length > 0 ? `--fix-type ${cliFixType.join(',')}` : '',
    maxWarnings !== undefined ? `--max-warnings=${maxWarnings}` : '',
    cliRules.length > 0 ? `--rule ${cliRules.join('--rule ')}` : '',
    files
      // makes output cleaner by removing absolute paths from filenames
      .map((f) => `"./${path.relative(cwd, f)}"`)
      .join(' '),
  ].join(' ');
  return `eslint ${args}`;
};

/**
 * Concatenate and escape a list of filenames that can be passed as args to prettier cli
 *
 * Prettier has an issue with special characters in filenames,
 * such as the ones uses for nextjs dynamic routes (ie: [id].tsx...)
 *
 * @link https://github.com/okonet/lint-staged/issues/676
 *
 * @param {string[]} filenames
 * @returns {string} Return concatenated and escaped filenames
 */
const concatFilesForPrettier = (filenames) =>
  filenames
    .map((filename) => `"${isWin ? filename : escape([filename])}"`)
    .join(' ');

const concatFilesForStylelint = concatFilesForPrettier;

module.exports = {
  concatFilesForPrettier,
  concatFilesForStylelint,
  getEslintFixCmd,
};
