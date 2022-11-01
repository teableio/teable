/**
 * Retrieve translations on server-side, wraps next-i18next.serverSideTranslations
 * to allow further customizations.
 */
import type { SSRConfig, UserConfig } from 'next-i18next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import nextI18nextConfig from '../../../next-i18next.config';

export const getServerSideTranslations = async (
  locale: string,
  namespacesRequired?: string[] | Readonly<string[]> | undefined,
  configOverride?: UserConfig | null
): Promise<SSRConfig> => {
  const override = configOverride ?? nextI18nextConfig;

  // Slice needed here cause serverSlideTranslations does not accept Readonly type
  return serverSideTranslations(locale, namespacesRequired?.slice(), override);
};
