import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@teable/sdk/context';
import { uniq } from 'lodash';
import type { InferGetServerSidePropsType, GetServerSideProps } from 'next';
import { useState } from 'react';
import { WaitlistPage } from '@/features/app/waitlist/WaitlistPage';
import { authConfig } from '@/features/i18n/auth.config';
import { systemConfig } from '@/features/i18n/system.config';
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
      ...(await getTranslationsProps(
        context,
        uniq([authConfig.i18nNamespaces, systemConfig.i18nNamespaces].flat())
      )),
    },
  };
});
