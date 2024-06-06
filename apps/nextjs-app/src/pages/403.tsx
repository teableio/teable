import type { GetStaticPropsContext } from 'next';
import { systemConfig } from '@/features/i18n/system.config';
import { ForbiddenPage } from '@/features/system/pages';
import { getServerSideTranslations } from '@/lib/i18n';

export const getStaticProps = async (context: GetStaticPropsContext) => {
  const { locale = 'en' } = context;

  const inlinedTranslation = await getServerSideTranslations(locale, systemConfig.i18nNamespaces);

  return {
    props: {
      locale: locale,
      ...inlinedTranslation,
    },
  };
};

export default function Custom403() {
  return <ForbiddenPage />;
}
