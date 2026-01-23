import { getLocaleFromBrowser, getLocaleFromCookie } from './helper';
export * from './helper';

type LocaleLoader = () => Promise<{ default: Record<string, unknown> }>;

export const detectStaticLocale = (cookie: string): string => {
  return getLocaleFromCookie(cookie) ?? getLocaleFromBrowser();
};

export const systemLocaleLoaders: Record<string, LocaleLoader> = {
  en: () => import('@teable/common-i18n/src/locales/en/system.json'),
  it: () => import('@teable/common-i18n/src/locales/it/system.json'),
  zh: () => import('@teable/common-i18n/src/locales/zh/system.json'),
  fr: () => import('@teable/common-i18n/src/locales/fr/system.json'),
  ja: () => import('@teable/common-i18n/src/locales/ja/system.json'),
  ru: () => import('@teable/common-i18n/src/locales/ru/system.json'),
  de: () => import('@teable/common-i18n/src/locales/de/system.json'),
  uk: () => import('@teable/common-i18n/src/locales/uk/system.json'),
  tr: () => import('@teable/common-i18n/src/locales/tr/system.json'),
  es: () => import('@teable/common-i18n/src/locales/es/system.json'),
};

export const loadSystemTranslations = async (locale: string) => {
  try {
    const loader = systemLocaleLoaders[locale] ?? systemLocaleLoaders.en;
    return (await loader()).default;
  } catch {
    return (await systemLocaleLoaders.en()).default;
  }
};
