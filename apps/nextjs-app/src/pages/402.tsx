import type { GetServerSideProps } from 'next';
import { systemConfig } from '@/features/i18n/system.config';
import { PaymentRequiredPage } from '@/features/system/pages';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

// withEnv seeds `env.embedMode` from the request, so a native-WebView hit on this
// route renders the neutral copy from the first paint instead of after hydration.
export const getServerSideProps: GetServerSideProps = withEnv(async (context) => {
  return {
    props: {
      ...(await getTranslationsProps(context, systemConfig.i18nNamespaces)),
    },
  };
});

export default function Custom402() {
  return <PaymentRequiredPage />;
}
