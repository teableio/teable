import type { GetServerSideProps } from 'next';
import { ssrApi } from '@/backend/api/rest/table.ssr';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context) => {
  const { baseId } = context.query;
  const tables = await ssrApi.getTables(baseId as string);
  const defaultTable = tables[0];
  if (defaultTable) {
    const defaultView = await ssrApi.getDefaultViewId(baseId as string, defaultTable.id);
    return {
      redirect: {
        destination: `/base/${baseId}/${defaultTable.id}/${defaultView.id}`,
        permanent: false,
      },
    };
  }

  return {
    redirect: {
      destination: `/base/${baseId}/dashboard`,
      permanent: false,
    },
  };
});

export default Node;
