import { LastVisitResourceType } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context, ssrApi) => {
  const { tableId, baseId, ...queryParams } = context.query;
  const queryString = new URLSearchParams(queryParams as Record<string, string>).toString();
  const userLastVisit = await ssrApi.getUserLastVisit(
    LastVisitResourceType.View,
    tableId as string
  );

  if (!userLastVisit) {
    return {
      notFound: true,
    };
  }

  return {
    redirect: {
      destination: `/base/${baseId}/${tableId}/${userLastVisit.resourceId}?${queryString}`,
      permanent: false,
    },
  };
});

export default Node;
