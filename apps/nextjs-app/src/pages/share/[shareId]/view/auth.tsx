import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@teable/sdk/context';
import type { GetServerSideProps } from 'next';
import { AuthPage } from '@/features/app/blocks/share/view/AuthPage';
import { shareConfig } from '@/features/i18n/share.config';
import { getTranslationsProps } from '@/lib/i18n';

const queryClient = createQueryClient();

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { i18nNamespaces } = shareConfig;
  return {
    props: {
      ...(await getTranslationsProps(context, i18nNamespaces)),
    },
  };
};

export default function ShareAuth() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthPage />
    </QueryClientProvider>
  );
}
