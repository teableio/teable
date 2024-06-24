import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@teable/sdk/context';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { authConfig } from '@/features/i18n/auth.config';
import { getTranslationsProps } from '@/lib/i18n';

type Props = {
  /** Add props here */
};

const queryClient = createQueryClient();

export default function LoginRoute(_props: InferGetServerSidePropsType<typeof getServerSideProps>) {
  return (
    <QueryClientProvider client={queryClient}>
      <LoginPage />
    </QueryClientProvider>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (context) => {
  const { i18nNamespaces } = authConfig;
  return {
    props: {
      ...(await getTranslationsProps(context, i18nNamespaces)),
    },
  };
};
