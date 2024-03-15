import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@teable/sdk/context';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage';
import { authConfig } from '@/features/i18n/auth.config';
import { getTranslationsProps } from '@/lib/i18n';

type Props = {
  /** Add props here */
};

export default function ForgetPasswordRoute(
  _props: InferGetServerSidePropsType<typeof getServerSideProps>
) {
  const queryClient = createQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ResetPasswordPage />
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
