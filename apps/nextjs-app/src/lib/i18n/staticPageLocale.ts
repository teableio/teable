import { getLocaleFromBrowser, getLocaleFromCookie } from './helper';
export * from './helper';

type LocaleLoader = () => Promise<{ default: Record<string, unknown> }>;

export const detectStaticLocale = (cookie: string): string => {
  return getLocaleFromCookie(cookie) ?? getLocaleFromBrowser();
};

export const commonLocaleLoaders: Record<string, LocaleLoader> = {
  en: () => import('@teable/common-i18n/src/locales/en/common.json'),
  it: () => import('@teable/common-i18n/src/locales/it/common.json'),
  zh: () => import('@teable/common-i18n/src/locales/zh/common.json'),
  fr: () => import('@teable/common-i18n/src/locales/fr/common.json'),
  ja: () => import('@teable/common-i18n/src/locales/ja/common.json'),
  ru: () => import('@teable/common-i18n/src/locales/ru/common.json'),
  de: () => import('@teable/common-i18n/src/locales/de/common.json'),
  uk: () => import('@teable/common-i18n/src/locales/uk/common.json'),
  tr: () => import('@teable/common-i18n/src/locales/tr/common.json'),
  es: () => import('@teable/common-i18n/src/locales/es/common.json'),
};

export const loadCommonTranslations = async (locale: string) => {
  try {
    const loader = commonLocaleLoaders[locale] ?? commonLocaleLoaders.en;
    return (await loader()).default;
  } catch {
    return (await commonLocaleLoaders.en()).default;
  }
};
