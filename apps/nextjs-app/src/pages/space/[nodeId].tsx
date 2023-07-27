import type { GetServerSideProps } from 'next';
import { SsrApi } from '@/backend/api/rest/table.ssr';
import type { NextPageWithLayout } from '../_app';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { nodeId } = context.query;
  const result = await new SsrApi().getDefaultViewId(nodeId as string);
  if (result.success) {
    return {
      redirect: {
        destination: `/space/${nodeId}/${result.data.id}`,
        permanent: false,
      },
    };
  }

  return {
    notFound: true,
  };
};

export default Node;
