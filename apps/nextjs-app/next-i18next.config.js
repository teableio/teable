const defaultLocale = 'en';
const debugI18n = ['true', 1].includes(process?.env?.NEXTJS_DEBUG_I18N ?? 'false');
const path = require('path');
const localePublicFolder = undefined;

const localPaths = [
  path.resolve('../../packages/common-i18n/src/locales'),
  path.join(__dirname, '../../../node_modules/@teable-group/common-i18n/src/locales'),
];

function getLocalPath() {
  if (typeof window === 'undefined') {
    const fs = require('node:fs');
    return localPaths.find((str) => {
      return fs.existsSync(str);
    });
  }

  return localePublicFolder;
}

const localePath = getLocalPath();
// console.log({ localePath: localePath });

/**
 * @type {import('next-i18next').UserConfig}
 */
module.exports = {
  i18n: {
    defaultLocale,
    locales: ['en', 'zh', 'fr'],
  },
  saveMissing: false,
  strictMode: true,
  serializeConfig: false,
  reloadOnPrerender: process?.env?.NODE_ENV === 'development',
  react: {
    useSuspense: false,
  },
  debug: debugI18n,
  /*
  interpolation: {
    escapeValue: false,
  },
  */
  localePath: localePath,
};
