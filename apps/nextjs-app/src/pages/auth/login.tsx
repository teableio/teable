import type { DehydratedState } from '@tanstack/react-query';
import { dehydrate, Hydrate, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import { createQueryClient } from '@teable/sdk/context';
import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';
import { useState } from 'react';
import { SsrApi } from '@/backend/api/rest/ssr-api';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { authConfig } from '@/features/i18n/auth.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import withEnv from '@/lib/withEnv';

type Props = {
  /** Add props here */
};

export default function LoginRoute(
  props: InferGetServerSidePropsType<typeof getServerSideProps> & {
    dehydratedState: DehydratedState;
  }
) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <Hydrate state={props.dehydratedState}>
        <LoginPage />
      </Hydrate>
    </QueryClientProvider>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = withEnv(
  ensureLogin(async (context) => {
    const { i18nNamespaces } = authConfig;
    const queryClient = new QueryClient();
    const ssrApi = new SsrApi();
    await Promise.all([
      queryClient.fetchQuery({
        queryKey: ReactQueryKeys.getPublicSetting(),
        queryFn: () => ssrApi.getPublicSetting(),
      }),
    ]);
    return {
      props: {
        ...(await getTranslationsProps(context, i18nNamespaces)),
        dehydratedState: dehydrate(queryClient),
      },
    };
  }, true)
);
