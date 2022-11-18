import { appWithTranslation } from 'next-i18next';
import type { AppProps as NextAppProps } from 'next/app';
import Head from 'next/head';
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

/**
 * @link https://nextjs.org/docs/advanced-features/custom-app
 */
const MyApp = (appProps: AppProps) => {
  const { Component, pageProps, err } = appProps;
  return (
    <AppProviders>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      {/* Workaround for https://github.com/vercel/next.js/issues/8592 */}
      <Component {...pageProps} err={err} />
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
