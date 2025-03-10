import { dehydrate, QueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { ReactElement } from 'react';
import { Design } from '@/features/app/blocks/design/Design';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import { tableConfig } from '@/features/i18n/table.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import type { IViewPageProps } from '@/lib/view-pages-data';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => {
  return <Design />;
};

export const getServerSideProps = withEnv(
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

      if (tables) {
        const { i18nNamespaces } = tableConfig;
        return {
          props: {
            tableServerData: tables,
            dehydratedState: dehydrate(queryClient),
            ...(await getTranslationsProps(context, i18nNamespaces)),
          },
        };
      }

      return {
        notFound: true,
      };
    })
  )
);

Node.getLayout = function getLayout(page: ReactElement, pageProps: IViewPageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Node;
