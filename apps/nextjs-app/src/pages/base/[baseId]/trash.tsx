import { dehydrate, QueryClient } from '@tanstack/react-query';
import type { ITableVo } from '@teable/openapi';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { BaseTrashPage } from '@/features/app/blocks/trash/BaseTrashPage';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { tableConfig } from '@/features/i18n/table.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Trash: NextPageWithLayout = () => <BaseTrashPage />;

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
      ]);

      return {
        props: {
          tableServerData: tables,
          dehydratedState: dehydrate(queryClient),
          ...(await getTranslationsProps(context, tableConfig.i18nNamespaces)),
        },
      };
    })
  )
);

Trash.getLayout = function getLayout(
  page: ReactElement,
  pageProps: { tableServerData: ITableVo[] }
) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Trash;
