/**
 * Retrieve translations on server-side, wraps next-i18next.serverSideTranslations
 * to allow further customizations.
 */
import type { SSRConfig, UserConfig } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import type { I18nNamespace } from '@/lib/i18n/I18nNamespace.types';

export const getServerSideTranslations = async (
  locale: string,
  namespacesRequired?: I18nNamespace[] | I18nNamespace | undefined,
  configOverride?: UserConfig | null,
  extraLocales?: string[] | false
): Promise<SSRConfig> => {
  return serverSideTranslations(locale, namespacesRequired, configOverride, extraLocales);
};
