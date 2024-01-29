import type { GetServerSideProps } from 'next';
import type { NextPageWithLayout } from '../_app';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = async () => {
  return {
    redirect: {
      destination: `/setting/personal-access-token`,
      permanent: false,
    },
  };
};

export default Node;
