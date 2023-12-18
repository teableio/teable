import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { systemConfig } from '@/features/i18n/system.config';
import { NotFoundPage } from '@/features/system/pages';
import { getTranslationsProps } from '@/lib/i18n';

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { i18nNamespaces } = systemConfig;

  return {
    props: {
      ...(await getTranslationsProps(context, i18nNamespaces)),
    },
  };
};

export default function Custom404(_props: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return <NotFoundPage />;
}
