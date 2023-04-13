import type { GetServerSideProps } from 'next';
import { getDefaultViewId } from 'server/services/ssr';
import type { NextPageWithLayout } from '../_app';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { nodeId } = context.query;
  const result = await getDefaultViewId(nodeId as string);

  return {
    redirect: {
      destination: `/space/${nodeId}/${result.id}`,
      permanent: false,
    },
  };
};

export default Node;
