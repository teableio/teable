import type { GetStaticPropsContext, InferGetStaticPropsType } from 'next';
import { NotFoundPage } from '@/features/system/pages';
import { systemConfig } from '@/features/system/system.config';
import { getServerSideTranslations } from '@/lib/i18n';

export const getStaticProps = async (context: GetStaticPropsContext) => {
  const { locale = 'en' } = context;

  const inlinedTranslation = await getServerSideTranslations(
    locale,
    systemConfig.i18nNamespaces
  );

  return {
    props: {
      locale: locale,
      ...inlinedTranslation,
    },
  };
};

export default function Custom404(
  _props: InferGetStaticPropsType<typeof getStaticProps>
) {
  return <NotFoundPage />;
}
