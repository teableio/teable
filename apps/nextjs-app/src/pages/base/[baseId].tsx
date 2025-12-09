import { dehydrate, QueryClient } from '@tanstack/react-query';
import { ReactQueryKeys } from '@teable/sdk/config';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { CommunityPage } from '@/features/app/base/CommunityPage';
import { getNodeUrl } from '@/features/app/blocks/base/base-node/hooks/helper';
import { BaseLayout } from '@/features/app/layouts/BaseLayout';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { IBasePageProps, NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const Node: NextPageWithLayout = () => {
  return <CommunityPage />;
};

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
      const { baseId } = context.query;
      const [userLastVisitNode, nodes] = await Promise.all([
        ssrApi.getUserLastVisitBaseNode({ parentResourceId: baseId as string }),
        ssrApi.getBaseNodeList(baseId as string),
      ]);

      const findNode = nodes.find((node) => node.resourceId === userLastVisitNode?.resourceId);
      if (findNode) {
        const url = getNodeUrl({
          baseId: baseId as string,
          resourceType: findNode.resourceType,
          resourceId: findNode.resourceId,
        });
        if (url && url.pathname) {
          return {
            redirect: {
              destination: url.pathname,
              permanent: false,
            },
          };
        }
      }

      const queryClient = new QueryClient();

      await Promise.all([
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
          dehydratedState: dehydrate(queryClient),
          ...(await getTranslationsProps(context, ['common', 'sdk', 'table'])),
        },
      };
    })
  )
);

Node.getLayout = function getLayout(page: ReactElement, pageProps: IBasePageProps) {
  return <BaseLayout {...pageProps}>{page}</BaseLayout>;
};

export default Node;
