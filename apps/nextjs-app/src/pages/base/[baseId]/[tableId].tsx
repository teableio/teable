import type { IHttpError } from '@teable/core';
import type { GetServerSideProps } from 'next';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const Node: NextPageWithLayout = () => {
  return <p>redirecting</p>;
};

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context, ssrApi) => {
  const { tableId, baseId, ...queryParams } = context.query;
  try {
    const queryString = new URLSearchParams(queryParams as Record<string, string>).toString();
    const result = await ssrApi.getDefaultViewId(baseId as string, tableId as string);
    return {
      redirect: {
        destination: `/base/${baseId}/${tableId}/${result.id}?${queryString}`,
        permanent: false,
      },
    };
  } catch (e) {
    const error = e as IHttpError;
    if (error.status < 500) {
      return {
        notFound: true,
      };
    }
    console.error(error);
    throw error;
  }
});

export default Node;
