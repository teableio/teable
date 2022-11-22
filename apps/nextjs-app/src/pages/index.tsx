import { HttpBadRequest } from '@belgattitude/http-exception';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import { demoConfig } from '@/features/demo/demo.config';
import { SideMenu } from '@/features/main/components/SideMenu';
type Props = {
  /** Add HomeRoute props here */
};

export default function DemoRoute(
  _props: InferGetServerSidePropsType<typeof getServerSideProps>
) {
  return <SideMenu />;
}

export const getServerSideProps: GetServerSideProps<Props> = async (
  context
) => {
  const locale = context.res.getHeader('X-Server-Locale') as string | undefined;
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
