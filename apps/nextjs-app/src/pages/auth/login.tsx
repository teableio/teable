import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { authConfig } from '@/features/i18n/auth.config';
import { getTranslationsProps } from '@/lib/i18n';

type Props = {
  /** Add props here */
};

export default function LoginRoute(_props: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return <LoginPage />;
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  const { i18nNamespaces } = authConfig;
  return {
    props: {
      ...(await getTranslationsProps(context, i18nNamespaces)),
    },
  };
};
