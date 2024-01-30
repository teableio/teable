import type { GetServerSideProps } from 'next';
import type { NextPageWithLayout } from '../../lib/type';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = async (context) => {
  const { baseId } = context.query;

  return {
    redirect: {
      destination: `/base/${baseId}/dashboard`,
      permanent: false,
    },
  };
};

export default Node;
