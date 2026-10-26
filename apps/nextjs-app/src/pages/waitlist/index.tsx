import type { InferGetServerSidePropsType, GetServerSideProps } from 'next';
import { TranslatedQueryClientProvider } from '@/features/app/components/TranslatedQueryClientProvider';
import { WaitlistPage } from '@/features/app/waitlist/WaitlistPage';
import { authConfig } from '@/features/i18n/auth.config';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

type Props = {/** Add props here */};

export default function WaitlistRoute(
  _props: InferGetServerSidePropsType<typeof getServerSideProps>
) {
  return (
    <TranslatedQueryClientProvider>
      <WaitlistPage />
    </TranslatedQueryClientProvider>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = withEnv(async (context) => {
  return {
    props: {
      ...(await getTranslationsProps(context, authConfig.i18nNamespaces)),
    },
  };
});
