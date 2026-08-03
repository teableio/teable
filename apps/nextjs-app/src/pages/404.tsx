import type { GetStaticProps } from 'next';
import { useTranslation } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import { useEffect, useState } from 'react';
import { systemConfig } from '@/features/i18n/system.config';
import { NotFoundPage } from '@/features/system/pages';
import {
  commonLocaleLoaders,
  detectStaticLocale,
  loadCommonTranslations,
} from '@/lib/i18n/staticPageLocale';

export const getStaticProps: GetStaticProps = async () => {
  return {
    props: {
      ...(await serverSideTranslations('en', systemConfig.i18nNamespaces)),
    },
  };
};

export default function Custom404() {
  const { i18n } = useTranslation();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const detectedLocale = detectStaticLocale(document.cookie);
    const validLocale = commonLocaleLoaders[detectedLocale] ? detectedLocale : 'en';

    // If locale matches current i18n locale, ready immediately
    if (validLocale === i18n.language) {
      setIsReady(true);
      return;
    }

    // Load translations for detected locale and update i18n
    loadCommonTranslations(validLocale)
      .then((translations) => {
        i18n.addResourceBundle(validLocale, 'common', translations, true, true);
        return i18n.changeLanguage(validLocale);
      })
      .catch((error) => {
        // Ensure UI remains usable even if translation loading or language change fails
        console.error('Failed to load translations or change language for 404 page:', error);
      })
      .finally(() => {
        setIsReady(true);
      });
  }, [i18n]);

  return (
    <div
      style={{
        opacity: isReady ? 1 : 0,
        transition: 'opacity 0.15s ease-in-out',
      }}
    >
      <NotFoundPage />
    </div>
  );
}
