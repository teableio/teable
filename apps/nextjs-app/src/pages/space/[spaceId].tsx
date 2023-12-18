import { dehydrate, QueryClient } from '@tanstack/react-query';
import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { ssrApi } from '@/backend/api/rest/table.ssr';
import { SpaceInnerPage } from '@/features/app/blocks/space';
import { SpaceLayout } from '@/features/app/layouts/SpaceLayout';
import withAuthSSR from '@/lib/withAuthSSR';
import type { NextPageWithLayout } from '../_app';

const Node: NextPageWithLayout = () => <SpaceInnerPage />;
export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context) => {
  const { spaceId } = context.query;
  const queryClient = new QueryClient();

  await queryClient.fetchQuery({
    queryKey: ['space', spaceId as string],
    queryFn: ({ queryKey }) => ssrApi.getSpaceById(queryKey[1]),
  });

  await queryClient.fetchQuery({
    queryKey: ['base-list', spaceId as string],
    queryFn: ({ queryKey }) => ssrApi.getBaseListBySpaceId(queryKey[1]),
  });

  await queryClient.fetchQuery({
    queryKey: ['space-collaborator-list', spaceId as string],
    queryFn: ({ queryKey }) => ssrApi.getSpaceCollaboratorList(queryKey[1]),
  });

  return {
    props: {
      dehydratedState: dehydrate(queryClient),
    },
  };
});

Node.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SpaceLayout {...pageProps}>{page}</SpaceLayout>;
};
export default Node;
