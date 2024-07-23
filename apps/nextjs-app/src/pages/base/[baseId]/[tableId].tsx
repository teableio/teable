import type { GetServerSideProps } from 'next';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context, ssrApi) => {
  const { tableId, baseId, ...queryParams } = context.query;
  const queryString = new URLSearchParams(queryParams as Record<string, string>).toString();
  const result = await ssrApi.getDefaultViewId(baseId as string, tableId as string);
  return {
    redirect: {
      destination: `/base/${baseId}/${tableId}/${result.id}?${queryString}`,
      permanent: false,
    },
  };
});

export default Node;
