import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { HttpError, parseDsn } from '@teable-group/core';
import { axios } from '@teable-group/openapi';
import type { IUser } from '@teable-group/sdk';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { NextPage } from 'next';
import type { AppContext, AppProps as NextAppProps } from 'next/app';
import App from 'next/app';
import Head from 'next/head';
import { appWithTranslation } from 'next-i18next';
import type { ReactElement, ReactNode } from 'react';
import { z } from 'zod';
import { colors } from '@/themes/colors';
import { INITIAL_THEME } from '@/themes/initial';
import { getColorsCssVariablesText } from '@/themes/utils';
import nextI18nextConfig from '../../next-i18next.config';
import { AppProviders } from '../AppProviders';

dayjs.extend(utc);
dayjs.extend(timezone);
extendZodWithOpenApi(z);

/**
 * Import global styles, global css or polyfills here
 * i.e.: import '@/assets/theme/style.scss'
 */
import '../styles/global.css';

/**
 * Local fonts
 * @link https://fontsource.org/docs/guides/nextjs
 */
import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
// @link https://fontsource.org/docs/variable-fonts
import '@fontsource/inter/variable.css';

// Workaround for https://github.com/zeit/next.js/issues/8592
export type AppProps = NextAppProps & {
  /** Will be defined only is there was an error */
  err?: Error;
};

export type NextPageWithLayout<P = Record<string, unknown>, IP = P> = NextPage<P, IP> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLayout?: (page: ReactElement, appProps: any) => ReactNode;
};

type AppPropsWithLayout = AppProps & {
  Component: NextPageWithLayout;
  user?: IUser;
  driver: string;
};

/**
 * @link https://nextjs.org/docs/advanced-features/custom-app
 */
const MyApp = (appProps: AppPropsWithLayout) => {
  const { Component, pageProps, err, user, driver } = appProps;
  // Use the layout defined at the page level, if available
  const getLayout = Component.getLayout ?? ((page) => page);

  const serverInfo = {
    driver,
    user,
  };

  return (
    <AppProviders>
      <Head>
        <meta
          name="viewport"
          content="width=device-width,viewport-fit=cover, initial-scale=1.0, minimum-scale=1.0, maximum-scale=1.0, user-scalable=no"
        />
        <style>{getColorsCssVariablesText(colors)}</style>
      </Head>
      <script dangerouslySetInnerHTML={{ __html: INITIAL_THEME }} />
      <script
        dangerouslySetInnerHTML={{
          __html: `window.__s = ${JSON.stringify(serverInfo)};`,
        }}
      />
      {/* Workaround for https://github.com/vercel/next.js/issues/8592 */}
      {getLayout(<Component {...pageProps} err={err} />, { ...pageProps, user })}
    </AppProviders>
  );
};

/**
 * Generally don't enable getInitialProp if you don't need to,
 * all your pages will be served server-side (no static optimizations).
 */

MyApp.getInitialProps = async (appContext: AppContext) => {
  // calls page's `getInitialProps` and fills `appProps.pageProps`
  const appProps = await App.getInitialProps(appContext);
  const res = appContext.ctx.res;
  const host = appContext.ctx.req?.headers.host || '';
  const isLoginPage = appContext.ctx.pathname.startsWith('/auth/login');

  if (!res || !res?.writeHead) {
    return appProps;
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { driver } = parseDsn(process.env.PRISMA_DATABASE_URL!);
  const initialProps = {
    ...appProps,
    driver,
  };

  try {
    const user = await axios.get<IUser>(`http://${host}/api/auth/user/me`, {
      headers: { cookie: appContext.ctx.req?.headers.cookie },
    });
    // Already logged in
    if (user && isLoginPage) {
      res.writeHead(302, {
        Location: `/space`,
      });
      res.end();
    }
    return { ...initialProps, user: user.data };
  } catch (error) {
    if (error instanceof HttpError && !isLoginPage) {
      const redirect = encodeURIComponent(appContext.ctx.req?.url || '');
      const query = redirect ? `redirect=${redirect}` : '';
      res.writeHead(302, {
        Location: `/auth/login?${query}`,
      });
      res.end();
    }
  }

  return initialProps;
};

export default appWithTranslation(MyApp, {
  ...nextI18nextConfig,
});
