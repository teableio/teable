import type { ParsedUrlQuery } from 'querystring';
import { HttpError } from '@teable/core';
import type {
  GetServerSidePropsContext,
  GetServerSidePropsResult,
  PreviewData,
  GetServerSideProps as NextGetServerSideProps,
} from 'next';
import { getUserMe } from '@/backend/api/rest/get-user';

type GetServerSideProps<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  P extends { [key: string]: any } = { [key: string]: any },
  Q extends ParsedUrlQuery = ParsedUrlQuery,
  D extends PreviewData = PreviewData,
> = (context: GetServerSidePropsContext<Q, D>) => Promise<GetServerSidePropsResult<P>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ensureLogin<P extends { [key: string]: any }>(
  handler: GetServerSideProps<P, ParsedUrlQuery, PreviewData>,
  isLoginPage?: boolean
): NextGetServerSideProps<P> {
  return async (context: GetServerSidePropsContext) => {
    const req = context.req;
    try {
      const user = await getUserMe(req?.headers.cookie);
      // Already logged in
      if (user && isLoginPage) {
        return {
          redirect: {
            destination: '/',
            permanent: false,
          },
        };
      }
      const res = await handler(context);
      if ('props' in res) {
        return {
          ...res,
          props: {
            ...(await res.props),
            user,
          },
        };
      }
      return {
        ...res,
        props: {
          user,
        },
      };
    } catch (error) {
      if (error instanceof HttpError && !isLoginPage) {
        const redirect = encodeURIComponent(req?.url || '');
        const query = redirect ? `redirect=${redirect}` : '';
        return {
          redirect: {
            destination: `/auth/login?${query}`,
            permanent: false,
          },
        };
      }
      if (isLoginPage) {
        return handler(context);
      }
      const res = await handler(context);
      if ('props' in res) {
        return {
          ...res,
          props: {
            ...(await res.props),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            err: (error as any)?.message,
          },
        };
      }
      return res;
    }
  };
}
