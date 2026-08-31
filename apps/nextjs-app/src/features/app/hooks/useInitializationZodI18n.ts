import { useTranslation } from 'next-i18next';
import { useEffect } from 'react';
import { z } from 'zod';
import { ar, de, en, es, fr, he, it, ja, ru, tr, uk, zhCN } from 'zod/v4/locales';

// Zod 4.x native i18n support, keyed by i18n.language (bare codes from next-i18next.config.js)
const localeErrorMaps = {
  zh: zhCN().localeError,
  'zh-CN': zhCN().localeError,
  en: en().localeError,
  'en-US': en().localeError,
  ar: ar().localeError,
  de: de().localeError,
  es: es().localeError,
  fr: fr().localeError,
  it: it().localeError,
  ja: ja().localeError,
  ru: ru().localeError,
  tr: tr().localeError,
  uk: uk().localeError,
  he: he().localeError,
};

export const useInitializationZodI18n = () => {
  const { i18n } = useTranslation();

  useEffect(() => {
    const language = i18n.language || 'en';
    // Map language codes to Zod locale error maps
    const errorMap =
      localeErrorMaps[language as keyof typeof localeErrorMaps] || localeErrorMaps['en'];
    z.config({ localeError: errorMap });
  }, [i18n.language]);
};
