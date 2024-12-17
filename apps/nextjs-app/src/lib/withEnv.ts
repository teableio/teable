import type { ParsedUrlQuery } from 'querystring';
import { parseDsn } from '@teable/core';
import { isUndefined, omitBy } from 'lodash';
import type {
  GetServerSidePropsContext,
  GetServerSidePropsResult,
  PreviewData,
  GetServerSideProps as NextGetServerSideProps,
} from 'next';

type GetServerSideProps<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  P extends { [key: string]: any } = { [key: string]: any },
  Q extends ParsedUrlQuery = ParsedUrlQuery,
  D extends PreviewData = PreviewData,
> = (context: GetServerSidePropsContext<Q, D>) => Promise<GetServerSidePropsResult<P>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function withEnv<P extends { [key: string]: any }>(
  handler: GetServerSideProps<P, ParsedUrlQuery, PreviewData>
): NextGetServerSideProps<P> {
  return async (context: GetServerSidePropsContext) => {
    const { driver } = parseDsn(process.env.PRISMA_DATABASE_URL as string);
    const env = omitBy(
      {
        driver,
        templateSiteLink: process.env.TEMPLATE_SITE_LINK,
        microsoftClarityId: process.env.MICROSOFT_CLARITY_ID,
        umamiUrl: process.env.UMAMI_URL,
        umamiWebSiteId: process.env.UMAMI_WEBSITE_ID,
        sentryDsn: process.env.SENTRY_DSN,
        socialAuthProviders: process.env.SOCIAL_AUTH_PROVIDERS?.split(','),
        storagePrefix: process.env.STORAGE_PREFIX,
        passwordLoginDisabled: process.env.PASSWORD_LOGIN_DISABLED === 'true' ? true : undefined,
      },
      isUndefined
    );
    const res = await handler(context);
    if ('props' in res) {
      return {
        ...res,
        props: {
          ...(await res.props),
          env,
        },
      };
    }
    return {
      ...res,
      props: {
        env,
      },
    };
  };
}
