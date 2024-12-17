import type { ParsedUrlQuery } from 'querystring';
import { HttpError } from '@teable/core';
import type {
  GetServerSidePropsContext,
  GetServerSidePropsResult,
  PreviewData,
  GetServerSideProps as NextGetServerSideProps,
} from 'next';
import { getUserMe } from '@/backend/api/rest/get-user';
import { providersAll } from '@/features/auth/components/SocialAuth';

/* eslint-disable @typescript-eslint/no-explicit-any */
type GetServerSideProps<
  P extends { [key: string]: any } = { [key: string]: any },
  Q extends ParsedUrlQuery = ParsedUrlQuery,
  D extends PreviewData = PreviewData,
> = (context: GetServerSidePropsContext<Q, D>) => Promise<GetServerSidePropsResult<P>>;

export default function ensureLogin<P extends { [key: string]: any }>(
  handler: GetServerSideProps<P, ParsedUrlQuery, PreviewData>,
  isLoginPage?: boolean
): NextGetServerSideProps<P> {
  return async (context: GetServerSidePropsContext) => {
    const req = context.req;
    let props: { [key: string]: any } = {};
    try {
      props['user'] = await getUserMe(req?.headers.cookie);

      // User is logged in, redirect to home page if on login page
      if (isLoginPage) {
        return {
          redirect: {
            destination: '/',
            permanent: false,
          },
        };
      }
    } catch (error) {
      if (error instanceof HttpError) {
        if (isLoginPage) {
          // User is not logged in, handle login page
          return redirectSocialAuth(req) || handler(context);
        } else {
          // User is not logged in, redirect to login page
          const redirect = encodeURIComponent(req?.url || '');
          const query = redirect ? `redirect=${redirect}` : '';
          return {
            redirect: {
              destination: `/auth/login?${query}`,
              permanent: false,
            },
          };
        }
      }

      // Workaround for https://github.com/zeit/next.js/issues/8592
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      props['err'] = (error as any)?.message;
    }

    const res = await handler(context);
    if ('props' in res) {
      props = {
        ...(await res.props),
        ...props,
      };
    }

    return {
      ...res,
      props: props as P,
    };
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Redirect to social auth if password login is disabled and only one provider is available
function redirectSocialAuth(req: GetServerSidePropsContext['req']) {
  const redirect = new URLSearchParams(req?.url?.split('?')[1] ?? '').get('redirect');
  const envProviders = process.env.SOCIAL_AUTH_PROVIDERS?.split(',') ?? [];
  const envPasswordLoginDisabled = process.env.PASSWORD_LOGIN_DISABLED === 'true';
  if (envPasswordLoginDisabled && envProviders.length === 1) {
    const provider = providersAll.find((provider) => provider.id === envProviders[0]);

    if (provider?.authUrl)
      return {
        redirect: {
          destination: redirect
            ? `${provider.authUrl}?redirect_uri=${encodeURIComponent(redirect)}`
            : provider.authUrl,
          permanent: false,
        },
      };
  }
}
