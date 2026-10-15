/**
 * Typescript class based component for custom-error
 * @link https://nextjs.org/docs/advanced-features/custom-error-page
 */

import type { NextPage, NextPageContext } from 'next';
import NextErrorComponent from 'next/error';
import type { ErrorProps } from 'next/error';
import { ErrorPage } from '@/features/system/pages';
import {
  commonLocaleLoaders,
  loadCommonTranslations,
  getLocaleFromCookie,
  getLocaleFromAcceptLanguage,
} from '@/lib/i18n/staticPageLocale';

// Adds HttpException to the list of possible error types.
type AugmentedError = NonNullable<NextPageContext['err']> | null;
type CustomErrorProps = {
  err?: AugmentedError;
  message?: string;
  hasGetInitialPropsRun?: boolean;
} & Omit<ErrorProps, 'err'>;

type AugmentedNextPageContext = Omit<NextPageContext, 'err'> & {
  err: AugmentedError;
};

const CustomError: NextPage<CustomErrorProps> = (props) => {
  const { statusCode, err, message } = props;

  return <ErrorPage error={err ?? undefined} message={message} statusCode={statusCode} />;
};

CustomError.getInitialProps = async (context: AugmentedNextPageContext) => {
  const { res, err, req } = context;

  const supportedLocales = Object.keys(commonLocaleLoaders);
  // Detect locale: prefer context.locale, fallback to cookie, then Accept-Language header, default to 'en'
  const cookieLocale = getLocaleFromCookie(req?.headers?.cookie ?? '');
  const acceptLangLocale = getLocaleFromAcceptLanguage(
    req?.headers?.['accept-language'],
    supportedLocales
  );
  const detectedLocale = context.locale || cookieLocale || acceptLangLocale || 'en';
  const locale = commonLocaleLoaders[detectedLocale] ? detectedLocale : 'en';

  const errorInitialProps = (await NextErrorComponent.getInitialProps({
    res,
    err,
  } as NextPageContext)) as CustomErrorProps;

  const resources = await loadCommonTranslations(locale);
  Object.assign(errorInitialProps, {
    _nextI18Next: {
      initialI18nStore: {
        [locale]: {
          common: resources,
        },
      },
      initialLocale: locale,
      ns: ['common'],
      userConfig: null,
    },
  });

  // Workaround for https://github.com/vercel/next.js/issues/8592, mark when
  // getInitialProps has run
  errorInitialProps.hasGetInitialPropsRun = true;

  return errorInitialProps;
};

export default CustomError;
