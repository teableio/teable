/**
 * Retrieve translations on server-side, wraps next-i18next.serverSideTranslations
 * to allow further customizations.
 */
import type { SSRConfig, UserConfig } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import type { I18nNamespace } from '@/lib/i18n/I18nNamespace.types';
import { pruneFallbackI18nStore } from './pruneFallbackStore';

export const getServerSideTranslations = async (
  locale: string,
  namespacesRequired?: I18nNamespace[] | I18nNamespace | undefined,
  configOverride?: UserConfig | null,
  extraLocales?: string[] | false
): Promise<SSRConfig> => {
  // Let serverSideTranslations auto-detect the nearest next-i18next.config.js
  // This allows EE apps to use their own config without explicitly passing it
  const ssrConfig = await serverSideTranslations(
    locale,
    namespacesRequired,
    configOverride,
    extraLocales
  );
  return pruneFallbackI18nStore(ssrConfig);
};
