import { LastVisitResourceType } from '@teable/openapi';
import type { GetServerSideProps } from 'next';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context, ssrApi) => {
  const { baseId, tableId, ...queryParams } = context.query;
  const queryString = new URLSearchParams(queryParams as Record<string, string>).toString();

  const [userLastVisitView, viewList] = await Promise.all([
    ssrApi.getUserLastVisit(LastVisitResourceType.View, tableId as string),
    ssrApi.getViewList(tableId as string),
  ]);

  const viewIds = viewList.map((view) => view.id);
  const viewId =
    userLastVisitView?.resourceId && viewIds.includes(userLastVisitView.resourceId)
      ? userLastVisitView.resourceId
      : viewIds[0];

  if (!viewId) {
    return {
      notFound: true,
    };
  }

  return {
    redirect: {
      destination: `/base/${baseId}/table/${tableId}/${viewId}?${queryString}`,
      permanent: false,
    },
  };
});

export default Node;
