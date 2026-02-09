import { dehydrate, QueryClient } from '@tanstack/react-query';
import { IS_TEMPLATE_HEADER, type ITableVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { AuthorityMatrixPage } from '@/features/app/blocks/AuthorityMatrix';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { baseAllConfig } from '@/features/i18n/base-all.config';
import ensureLogin from '@/lib/ensureLogin';
import handleBase from '@/lib/handleBase';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => <AuthorityMatrixPage />;

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { baseId } = context.query;
      const queryClient = new QueryClient();
      const base = await handleBase(baseId as string, ssrApi, queryClient);
      await Promise.all([
        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.base(baseId as string),
          queryFn: () => base,
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getBasePermission(baseId as string),
          queryFn: ({ queryKey }) => ssrApi.getBasePermission(queryKey[1]),
        }),
      ]);

      const templateHeader = base?.template?.headers;
      if (templateHeader) {
        ssrApi.disableLastVisit = true;
        ssrApi.axios.interceptors.request.use((config) => {
          config.headers[IS_TEMPLATE_HEADER] = templateHeader;
          return config;
        });
      }

      return {
        props: {
          dehydratedState: dehydrate(queryClient),
          ...(await getTranslationsProps(context, baseAllConfig.i18nNamespaces)),
        },
      };
    })
  )
);

Node.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[] }
) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};
export default Node;
