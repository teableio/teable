import { useTranslation } from 'next-i18next';
import { useEffect } from 'react';
import { z } from 'zod';
import { zhCN, en } from 'zod/v4/locales';

// Zod 4.x native i18n support
const localeErrorMaps = {
  'zh-CN': zhCN().localeError,
  en: en().localeError,
  'en-US': en().localeError,
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
