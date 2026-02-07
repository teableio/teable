/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParsedUrlQuery } from 'querystring';
import { HttpError, type IHttpError } from '@teable/core';
import { isUndefined, omitBy } from 'lodash';
import type {
  GetServerSidePropsContext,
  GetServerSidePropsResult,
  PreviewData,
  GetServerSideProps as NextGetServerSideProps,
} from 'next';
import { SsrApi } from '@/backend/api/rest/ssr-api';

export type SSRHttpError = { httpError: IHttpError };

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

export type GetServerSideProps<
  P extends { [key: string]: any } = { [key: string]: any },
  Q extends ParsedUrlQuery = ParsedUrlQuery,
  D extends PreviewData = PreviewData,
  T extends SsrApi = SsrApi,
> = (
  context: GetServerSidePropsContext<Q, D>,
  ssrApi: T
) => Promise<GetServerSidePropsResult<P | SSRHttpError>>;

export default function withAuthSSR<
  P extends { [key: string]: any } = { [key: string]: any },
  T extends SsrApi = SsrApi,
>(
  handler: GetServerSideProps<P, ParsedUrlQuery, PreviewData, T>,
  ssrClass: new () => T = SsrApi as new () => T
): NextGetServerSideProps<P | SSRHttpError> {
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
      if (error.status === 402 || error.status === 403) {
        context.res.statusCode = error.status;
        return {
          props: {
            httpError: omitBy(
              {
                message: error.message,
                status: error.status,
                code: error.code,
                data: error.data,
              },
              isUndefined
            ) as IHttpError,
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
