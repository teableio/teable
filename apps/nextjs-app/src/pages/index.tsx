import { HttpBadRequest } from '@belgattitude/http-exception';
import type { GetStaticProps, InferGetStaticPropsType } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import { demoConfig } from '@/features/demo/demo.config';
import { DemoPage } from '@/features/demo/pages';

type Props = {
  /** Add HomeRoute props here */
};

export default function DemoRoute(
  _props: InferGetStaticPropsType<typeof getStaticProps>
) {
  return <DemoPage />;
}

export const getStaticProps: GetStaticProps<Props> = async (context) => {
  const { locale } = context;
  if (locale === undefined) {
    throw new HttpBadRequest('locale is missing');
  }
  const { i18nNamespaces } = demoConfig;
  return {
    props: {
      ...(await serverSideTranslations(locale, i18nNamespaces)),
    },
  };
};
