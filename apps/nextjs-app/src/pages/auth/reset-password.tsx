import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@teable/sdk/context';
import type { GetServerSideProps } from 'next';
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage';
import { authConfig } from '@/features/i18n/auth.config';
import { getTranslationsProps } from '@/lib/i18n';

export default function ForgetPasswordRoute() {
  const queryClient = createQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ResetPasswordPage />
    </QueryClientProvider>
  );
}

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { i18nNamespaces } = authConfig;
  return {
    props: {
      ...(await getTranslationsProps(context, i18nNamespaces)),
    },
  };
};
