/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ParsedUrlQuery } from 'querystring';
import { parseDsn } from '@teable/core';
import { isUndefined, omitBy, toNumber } from 'lodash';
import type {
  GetServerSidePropsContext,
  GetServerSidePropsResult,
  PreviewData,
  GetServerSideProps as NextGetServerSideProps,
} from 'next';

type GetServerSideProps<
  P extends { [key: string]: any } = { [key: string]: any },
  Q extends ParsedUrlQuery = ParsedUrlQuery,
  D extends PreviewData = PreviewData,
> = (context: GetServerSidePropsContext<Q, D>) => Promise<GetServerSidePropsResult<P>>;

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
        maxSearchFieldCount: process.env.MAX_SEARCH_FIELD_COUNT
          ? toNumber(process.env.MAX_SEARCH_FIELD_COUNT) === Infinity
            ? // Infinity has been transformed to null unexpectedly
              undefined
            : toNumber(process.env.MAX_SEARCH_FIELD_COUNT)
          : 20,
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
