// @ts-check

/**
 * This is the base lint-staged rules config and just includes oxfmt by default.
 * A good practice is to override this base configuration in each package and/or application
 * where we are able to add customization depending on the nature of the project (oxlint...).
 *
 * {@link https://github.com/okonet/lint-staged#how-to-use-lint-staged-in-a-multi-package-monorepo}
 * {@link https://github.com/teableio/teable/blob/main/docs/about-lint-staged.md}
 */

const { concatFilesForOxfmt } = require('./lint-staged.common.js');

/**
 * @type {Record<string, (filenames: string[]) => string | string[] | Promise<string | string[]>>}
 */
const rules = {
  '{apps,packages}/**/*.{json,md,mdx,css,html,yml,yaml,scss,ts,js,tsx,jsx,mjs}': (filenames) => {
    return [`oxfmt --no-error-on-unmatched-pattern ${concatFilesForOxfmt(filenames)}`];
  },
};

module.exports = rules;
