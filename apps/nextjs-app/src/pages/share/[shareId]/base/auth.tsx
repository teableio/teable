import type { GetServerSideProps } from 'next';
import { BaseShareAuthPage } from '@/features/app/blocks/share/base/BaseShareAuthPage';
import { TranslatedQueryClientProvider } from '@/features/app/components/TranslatedQueryClientProvider';
import { shareConfig } from '@/features/i18n/share.config';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

export const getServerSideProps: GetServerSideProps = withEnv(async (context) => {
  const { i18nNamespaces } = shareConfig;
  context.res.setHeader('Content-Security-Policy', 'frame-ancestors *;');
  return {
    props: {
      ...(await getTranslationsProps(context, i18nNamespaces)),
    },
  };
});

export default function ShareBaseAuth() {
  return (
    <TranslatedQueryClientProvider>
      <BaseShareAuthPage />
    </TranslatedQueryClientProvider>
  );
}
