import { HttpBadRequest } from '@belgattitude/http-exception';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import { appConfig } from '@/features/app/app.config';
import { AppPage } from '@/features/app/pages';
import i18nConfig from '../../next-i18next.config';
type Props = {
  /** Add HomeRoute props here */
};

export default function DemoRoute(
  _props: InferGetServerSidePropsType<typeof getServerSideProps>
) {
  return <AppPage />;
}

export const getServerSideProps: GetServerSideProps<Props> = async (
  context
) => {
  const locale = context.res.getHeader('X-Server-Locale') as string | undefined;
  if (locale === undefined) {
    throw new HttpBadRequest('locale is missing');
  }
  const { i18nNamespaces } = appConfig;
  return {
    props: {
      ...(await serverSideTranslations(locale, i18nNamespaces, i18nConfig)),
    },
  };
};
