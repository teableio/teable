import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@teable/sdk/context';
import type { GetServerSideProps } from 'next';
import { ForgetPasswordPage } from '@/features/auth/pages/ForgetPasswordPage';
import { authConfig } from '@/features/i18n/auth.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

export default function ForgetPasswordRoute() {
  const queryClient = createQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ForgetPasswordPage />
    </QueryClientProvider>
  );
}

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(async (context) => {
    const { i18nNamespaces } = authConfig;
    return {
      props: {
        ...(await getTranslationsProps(context, i18nNamespaces)),
      },
    };
  }, true)
);
