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
    const envMaxSearchFieldCount = toNumber(process.env.MAX_SEARCH_FIELD_COUNT);
    const storage = {
      provider: process.env.BACKEND_STORAGE_PROVIDER ?? 'local',
      prefix: process.env.STORAGE_PREFIX ?? process.env.PUBLIC_ORIGIN,
      publicBucket: process.env.BACKEND_STORAGE_PUBLIC_BUCKET ?? 'public',
      publicUrl: process.env.BACKEND_STORAGE_PUBLIC_URL,
    };
    const env = omitBy(
      {
        driver,
        templateSiteLink: process.env.TEMPLATE_SITE_LINK,
        microsoftClarityId: process.env.MICROSOFT_CLARITY_ID,
        umamiUrl: process.env.UMAMI_URL,
        umamiWebSiteId: process.env.UMAMI_WEBSITE_ID,
        gaId: process.env.GA_ID,
        sentryDsn: process.env.SENTRY_DSN,
        socialAuthProviders: process.env.SOCIAL_AUTH_PROVIDERS?.split(','),
        storage: omitBy(storage, isUndefined),
        passwordLoginDisabled: process.env.PASSWORD_LOGIN_DISABLED === 'true' ? true : undefined,
        publicDatabaseProxy: process.env.PUBLIC_DATABASE_PROXY,
        // default to Infinity, return undefined causing the value will be transformed to null when json-stringify
        maxSearchFieldCount:
          isNaN(envMaxSearchFieldCount) || envMaxSearchFieldCount === Infinity
            ? undefined
            : envMaxSearchFieldCount,
        publicOrigin: process.env.PUBLIC_ORIGIN,
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
