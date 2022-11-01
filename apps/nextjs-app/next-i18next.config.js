const defaultLocale = 'en';
const debugI18n = ['true', 1].includes(
  process?.env?.NEXTJS_DEBUG_I18N ?? 'false'
);

const localePublicFolder = undefined;

/**
 * @type {import('next-i18next').UserConfig}
 */
module.exports = {
  i18n: {
    defaultLocale,
    locales: ['en', 'fr'],
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
  localePath:
    typeof window === 'undefined'
      ? require('path').resolve('../../packages/common-i18n/src/locales')
      : localePublicFolder,
};
