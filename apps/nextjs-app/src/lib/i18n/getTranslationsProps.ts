import type { GetServerSidePropsContext } from 'next';
import i18nConfig from '../../../next-i18next.config';
import { getServerSideTranslations } from './getServerSideTranslations';
import type { I18nNamespace } from './I18nNamespace.types';

export const CookieLocaleKey = 'X-Server-Locale';

export const getTranslationsProps = (
  context: GetServerSidePropsContext,
  i18nNamespaces: I18nNamespace[] | I18nNamespace | undefined
) => {
  const locale = context.res.getHeader(CookieLocaleKey) as string | undefined;
  return getServerSideTranslations(locale || 'en', i18nNamespaces, i18nConfig);
};
