import { HttpBadRequest } from '@belgattitude/http-exception';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { serverSideTranslations } from 'next-i18next/serverSideTranslations';
import { authConfig } from '@/features/auth/auth.config';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import i18nConfig from '../../../next-i18next.config';

type Props = {
  /** Add props here */
};

export default function LoginRoute(
  _props: InferGetServerSidePropsType<typeof getServerSideProps>
) {
  return <LoginPage />;
}

export const getServerSideProps: GetServerSideProps<Props> = async (
  context
) => {
  const locale = context.res.getHeader('X-Server-Locale') as string | undefined;
  if (locale === undefined) {
    throw new HttpBadRequest('locale is missing');
  }
  const { i18nNamespaces } = authConfig;
  return {
    props: {
      ...(await serverSideTranslations(locale, i18nNamespaces, i18nConfig)),
    },
  };
};
