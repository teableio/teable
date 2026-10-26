import type { GetServerSideProps } from 'next';
import { TranslatedQueryClientProvider } from '@/features/app/components/TranslatedQueryClientProvider';
import { ResetPasswordPage } from '@/features/auth/pages/ResetPasswordPage';
import { authConfig } from '@/features/i18n/auth.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

export default function ForgetPasswordRoute() {
  return (
    <TranslatedQueryClientProvider>
      <ResetPasswordPage />
    </TranslatedQueryClientProvider>
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
