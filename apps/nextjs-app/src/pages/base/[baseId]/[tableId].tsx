import type { IHttpError } from '@teable-group/core';
import type { GetServerSideProps } from 'next';
import { ssrApi } from '@/backend/api/rest/table.ssr';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context) => {
  const { tableId, baseId } = context.query;
  try {
    const result = await ssrApi.getDefaultViewId(baseId as string, tableId as string);
    return {
      redirect: {
        destination: `/base/${baseId}/${tableId}/${result.id}`,
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
