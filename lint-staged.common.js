// @ts-check

const path = require('node:path');
const escape = require('shell-quote').quote;

const isWin = process.platform === 'win32';

const oxlintGlobalAllowedRules = [
  // react-hooks/eslint and react in general is very strict about exhaustively
  // declaring the dependencies when using the useEffect, useCallback... hooks.
  //
  // In some specific scenarios declaring the deps seems 'less' wanted or 'less' applicable
  // by the developer, leading to some exceptions in the code. That said it should be avoided.
  //
  // While the 'react-hooks/exhaustive-deps' rule is a good rule of thumb, it's not recommended to
  // enforce it from lint-staged as it can potentially break a legit intent.
  //
  // Reminder that a good practice is to always declare the dependencies when using the hooks,
  // and if not applicable, add a disable comment to the useEffect, useCallback... such as:
  //
  //    // eslint-disable-next-line react-hooks/exhaustive-deps
  //
  // Another approach can be to use hooks such as https://github.com/kentcdodds/use-deep-compare-effect to quickly bypass
  // shallow rendering limitations.
  //
  // @see https://reactjs.org/docs/hooks-rules.html
  'react-hooks/exhaustive-deps',
];

/**
 * Lint-staged commands for code files in packages or apps: oxfmt formats them,
 * then oxlint reports. Lint problems are not auto-fixed, since a fix that
 * changes the AST should not land unreviewed from a commit hook.
 * @param {{cwd: string, files: string[], maxWarnings?: number}} params
 */
const getOxcCmds = ({ cwd, files, maxWarnings }) => {
  // makes output cleaner by removing absolute paths from filenames
  const cliFiles = files.map((f) => `"./${path.relative(cwd, f)}"`).join(' ');
  // A staged file can sit under the package's ignorePatterns; that is not a failure.
  const report = [
    '--no-error-on-unmatched-pattern',
    ...oxlintGlobalAllowedRules.map((rule) => `--allow ${rule}`),
    maxWarnings !== undefined ? `--max-warnings=${maxWarnings}` : '',
    cliFiles,
  ]
    .filter((arg) => arg.length > 0)
    .join(' ');
  return [`oxfmt --no-error-on-unmatched-pattern ${cliFiles}`, `oxlint ${report}`];
};

/**
 * Concatenate and escape a list of filenames that can be passed as args to oxfmt cli
 *
 * Filenames can hold glob characters, such as the ones used for nextjs dynamic
 * routes (ie: [id].tsx...)
 *
 * @param {string[]} filenames
 * @returns {string} Return concatenated and escaped filenames
 */
const concatFilesForOxfmt = (filenames) =>
  filenames.map((filename) => `"${isWin ? filename : escape([filename])}"`).join(' ');

const concatFilesForStylelint = concatFilesForOxfmt;

module.exports = {
  concatFilesForOxfmt,
  concatFilesForStylelint,
  getOxcCmds,
};
