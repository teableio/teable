import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);
extendZodWithOpenApi(z);

import type { NextPage } from 'next';
import { appWithTranslation } from 'next-i18next';
import type { AppProps as NextAppProps } from 'next/app';
import Head from 'next/head';
import type { ReactElement, ReactNode } from 'react';
import { z } from 'zod';

import { colors } from '@/themes/colors';
import { INITIAL_THEME } from '@/themes/initial';
import { getColorsCssVariablesText } from '@/themes/utils';
import nextI18nextConfig from '../../next-i18next.config';
import { AppProviders } from '../AppProviders';

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
};

/**
 * @link https://nextjs.org/docs/advanced-features/custom-app
 */
const MyApp = (appProps: AppPropsWithLayout) => {
  const { Component, pageProps, err } = appProps;
  // Use the layout defined at the page level, if available
  const getLayout = Component.getLayout ?? ((page) => page);
  return (
    <AppProviders>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>{getColorsCssVariablesText(colors)}</style>
      </Head>
      <script dangerouslySetInnerHTML={{ __html: INITIAL_THEME }} />
      {/* Workaround for https://github.com/vercel/next.js/issues/8592 */}
      {getLayout(<Component {...pageProps} err={err} />, pageProps)}
    </AppProviders>
  );
};

/**
 * Generally don't enable getInitialProp if you don't need to,
 * all your pages will be served server-side (no static optimizations).
 */
/*
MyApp.getInitialProps = async appContext => {
   // calls page's `getInitialProps` and fills `appProps.pageProps`
   const appProps = await App.getInitialProps(appContext)
   return { ...appProps }
}
*/

export default appWithTranslation(MyApp, {
  ...nextI18nextConfig,
});
