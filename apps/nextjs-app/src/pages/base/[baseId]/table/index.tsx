import { LastVisitResourceType } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context, ssrApi) => {
  const { baseId, ...queryParams } = context.query;
  const queryString = new URLSearchParams(queryParams as Record<string, string>).toString();
  const userLastVisitTable = await ssrApi.getUserLastVisit(
    LastVisitResourceType.Table,
    baseId as string
  );

  if (!userLastVisitTable) {
    return {
      notFound: true,
    };
  }

  const userLastVisitView = await ssrApi.getUserLastVisit(
    LastVisitResourceType.View,
    userLastVisitTable.resourceId as string
  );

  if (!userLastVisitView) {
    return {
      notFound: true,
    };
  }

  return {
    redirect: {
      destination: `/base/${baseId}/table/${userLastVisitTable.resourceId}/${userLastVisitView.resourceId}?${queryString}`,
      permanent: false,
    },
  };
});

export default Node;
