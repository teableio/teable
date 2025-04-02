/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParsedUrlQuery } from 'querystring';
import type { IHttpError } from '@teable/core';
import type {
  GetServerSidePropsContext,
  GetServerSidePropsResult,
  PreviewData,
  GetServerSideProps as NextGetServerSideProps,
} from 'next';
import { SsrApi } from '@/backend/api/rest/ssr-api';

export type GetServerSideProps<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  P extends { [key: string]: any } = { [key: string]: any },
  Q extends ParsedUrlQuery = ParsedUrlQuery,
  D extends PreviewData = PreviewData,
  T extends SsrApi = SsrApi,
> = (context: GetServerSidePropsContext<Q, D>, ssrApi: T) => Promise<GetServerSidePropsResult<P>>;

export default function withAuthSSR<P extends { [key: string]: any }, T extends SsrApi = SsrApi>(
  handler: GetServerSideProps<P, ParsedUrlQuery, PreviewData, T>,
  ssrClass: new () => T = SsrApi as new () => T
): NextGetServerSideProps<P> {
  return async (context: GetServerSidePropsContext) => {
    const req = context.req;
    try {
      const ssrApi = new ssrClass();
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
      if (error.status === 402) {
        return {
          redirect: {
            destination: `/402`,
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
      if (error.status == 404) {
        return {
          notFound: true,
        };
      }
      console.error(error);
      throw error;
    }
  };
}
