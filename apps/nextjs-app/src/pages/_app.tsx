import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { HttpError, parseDsn } from '@teable/core';
import type { IUser } from '@teable/sdk';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import type { AppContext, AppProps as NextAppProps } from 'next/app';
import App from 'next/app';
import Head from 'next/head';
import { appWithTranslation } from 'next-i18next';
import { z } from 'zod';
import { getUserMe } from '@/backend/api/rest/get-user';
import { Guide } from '@/components/Guide';
import RouterProgressBar from '@/components/RouterProgress';
import type { NextPageWithLayout } from '@/lib/type';
import { colors } from '@/themes/colors';
import { INITIAL_THEME } from '@/themes/initial';
import { getColorsCssVariablesText } from '@/themes/utils';
import nextI18nextConfig from '../../next-i18next.config.js';
import { AppProviders } from '../AppProviders';

dayjs.extend(utc);
dayjs.extend(timezone);
extendZodWithOpenApi(z);

/**
 * Import global styles, global css or polyfills here
 * i.e.: import '@/assets/theme/style.scss'
 */
import '../styles/global.css';

import '@fontsource-variable/inter';

// Workaround for https://github.com/zeit/next.js/issues/8592
export type AppProps = NextAppProps & {
  /** Will be defined only is there was an error */
  err?: Error;
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
    <>
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
      <Guide user={user} />
      <RouterProgressBar />
    </>
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
  if (!res || !res?.writeHead) {
    return appProps;
  }

  const isLoginPage = appContext.ctx.pathname === '/auth/login';
  const needLoginPage = isAuthLoginPage(appContext.ctx.pathname);

  const { driver } = parseDsn(process.env.PRISMA_DATABASE_URL as string);
  const initialProps = {
    ...appProps,
    driver,
  };
  if (!isLoginPage && !needLoginPage) {
    return initialProps;
  }

  try {
    const user = await getUserMe(appContext.ctx.req?.headers.cookie);
    // Already logged in
    if (user && isLoginPage) {
      res.writeHead(302, {
        Location: `/space`,
      });
      res.end();
      return {};
    }
    return { ...initialProps, user };
  } catch (error) {
    if (error instanceof HttpError && !isLoginPage) {
      const redirect = encodeURIComponent(appContext.ctx.req?.url || '');
      const query = redirect ? `redirect=${redirect}` : '';
      res.writeHead(302, {
        Location: `/auth/login?${query}`,
      });
      res.end();
      return {};
    }
    return { ...initialProps, err: error };
  }
};

const isAuthLoginPage = (pathname: string) => {
  const needLoginPage = ['/space', '/base', '/invite', '/setting'];
  return needLoginPage.some((path) => pathname.startsWith(path));
};

export default appWithTranslation(MyApp, {
  ...nextI18nextConfig,
});
