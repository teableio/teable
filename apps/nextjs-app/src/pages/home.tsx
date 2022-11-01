import { HttpBadRequest } from '@belgattitude/http-exception';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import { homeConfig } from '@/features/home/home.config';
import { HomePage } from '@/features/home/pages';

type Props = {
  /** Add HomeRoute props here */
};

export default function HomeRoute(
  _props: InferGetServerSidePropsType<typeof getServerSideProps>
) {
  return <HomePage />;
}

export const getServerSideProps: GetServerSideProps<Props> = async (
  context
) => {
  const { locale } = context;
  if (locale === undefined) {
    throw new HttpBadRequest('locale is missing');
  }
  const { i18nNamespaces } = homeConfig;
  return {
    props: {
      ...(await serverSideTranslations(locale, i18nNamespaces)),
    },
  };
};
