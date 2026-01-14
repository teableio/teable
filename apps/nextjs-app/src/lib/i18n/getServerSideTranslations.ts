/**
 * Retrieve translations on server-side, wraps next-i18next.serverSideTranslations
 * to allow further customizations.
 */
import type { SSRConfig, UserConfig } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import type { I18nNamespace } from '@/lib/i18n/I18nNamespace.types';
import nextI18nextConfig from '../../../next-i18next.config.js';

export const getServerSideTranslations = async (
  locale: string,
  namespacesRequired?: I18nNamespace[] | I18nNamespace | undefined,
  configOverride?: UserConfig | null,
  extraLocales?: string[] | false
): Promise<SSRConfig> => {
  // Use explicitly imported config as fallback to avoid runtime file resolution issues
  // This ensures the config is bundled at build time rather than dynamically loaded
  const config = configOverride ?? nextI18nextConfig;
  return serverSideTranslations(locale, namespacesRequired, config, extraLocales);
};
