import type { IHttpError } from '@teable-group/core';
import type { GetServerSideProps, GetServerSidePropsContext } from 'next';
import { ssrApi } from '@/backend/api/rest/table.ssr';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function withAuthSSR<P extends { [key: string]: any }>(
  handler: GetServerSideProps<P>
) {
  return async (context: GetServerSidePropsContext) => {
    const req = context.req;
    try {
      ssrApi.axios.defaults.headers['cookie'] = req.headers.cookie || '';
      return await handler(context);
    } catch (e) {
      const error = e as IHttpError;
      if (error.status === 401) {
        return {
          redirect: {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            destination: `/auth/login?redirect=${encodeURIComponent(req.url!)}`,
            permanent: false,
          },
        };
      }
      throw error;
    }
  };
}
