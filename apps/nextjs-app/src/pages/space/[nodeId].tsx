import type { IHttpError } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import { ssrApi } from '@/backend/api/rest/table.ssr';
import withAuthSSR from '@/lib/withAuthSSR';
import type { NextPageWithLayout } from '../_app';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context) => {
  const { nodeId } = context.query;
  try {
    const result = await ssrApi.getDefaultViewId(nodeId as string);
    return {
      redirect: {
        destination: `/space/${nodeId}/${result.id}`,
        permanent: false,
      },
    };
  } catch (e) {
    const error = e as IHttpError;
    if (error.status !== 401) {
      return {
        notFound: true,
      };
    }
    throw error;
  }
});

export default Node;
