import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@teable/sdk/context';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { useState } from 'react';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { authConfig } from '@/features/i18n/auth.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

type Props = {
  /** Add props here */
};

export default function LoginRoute(_props: InferGetServerSidePropsType<typeof getServerSideProps>) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <LoginPage />
    </QueryClientProvider>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = withEnv(
  ensureLogin(async (context) => {
    const { i18nNamespaces } = authConfig;
    return {
      props: {
        ...(await getTranslationsProps(context, i18nNamespaces)),
      },
    };
  }, true)
);
