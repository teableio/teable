import type { ParsedUrlQuery } from 'querystring';
import type { IHttpError } from '@teable/core';
import type { GetServerSidePropsContext, GetServerSidePropsResult, PreviewData } from 'next';
import { SsrApi } from '@/backend/api/rest/table.ssr';

export type GetServerSideProps<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  P extends { [key: string]: any } = { [key: string]: any },
  Q extends ParsedUrlQuery = ParsedUrlQuery,
  D extends PreviewData = PreviewData,
> = (
  context: GetServerSidePropsContext<Q, D>,
  ssrApi: SsrApi
) => Promise<GetServerSidePropsResult<P>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function withAuthSSR<P extends { [key: string]: any }>(
  handler: GetServerSideProps<P>
) {
  return async (context: GetServerSidePropsContext) => {
    const req = context.req;
    try {
      const ssrApi = new SsrApi();
      ssrApi.axios.defaults.headers['cookie'] = req.headers.cookie || '';
      return await handler(context, ssrApi);
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
      if (error.status === 403) {
        return {
          redirect: {
            destination: `/403`,
            permanent: false,
          },
        };
      }
      throw error;
    }
  };
}
