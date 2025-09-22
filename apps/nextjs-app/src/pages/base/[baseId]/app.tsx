import { dehydrate, QueryClient } from '@tanstack/react-query';
import type { ITableVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { AppPage } from '@/features/app/blocks/App';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => <AppPage />;

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { baseId } = context.query;
      const queryClient = new QueryClient();

      const [tables] = await Promise.all([
        ssrApi.getTables(baseId as string),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.base(baseId as string),
          queryFn: ({ queryKey }) =>
            queryKey[1] ? ssrApi.getBaseById(baseId as string) : undefined,
        }),

        queryClient.fetchQuery({
          queryKey: ReactQueryKeys.getBasePermission(baseId as string),
          queryFn: ({ queryKey }) => ssrApi.getBasePermission(queryKey[1]),
        }),
      ]);

      return {
        props: {
          tableServerData: tables,
          dehydratedState: dehydrate(queryClient),
          ...(await getTranslationsProps(context, ['common', 'space', 'sdk'])),
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
