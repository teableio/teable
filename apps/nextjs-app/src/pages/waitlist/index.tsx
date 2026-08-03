import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@teable/sdk/context';
import type { InferGetServerSidePropsType, GetServerSideProps } from 'next';
import { useState } from 'react';
import { WaitlistPage } from '@/features/app/waitlist/WaitlistPage';
import { authConfig } from '@/features/i18n/auth.config';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

type Props = {
  /** Add props here */
};

export default function WaitlistRoute(
  _props: InferGetServerSidePropsType<typeof getServerSideProps>
) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <WaitlistPage />
    </QueryClientProvider>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = withEnv(async (context) => {
  return {
    props: {
      ...(await getTranslationsProps(context, authConfig.i18nNamespaces)),
    },
  };
});
