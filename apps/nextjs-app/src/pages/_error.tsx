/**
 * Typescript class based component for custom-error
 * @link https://nextjs.org/docs/advanced-features/custom-error-page
 */

import { captureException as sentryCaptureException, flush as sentryFlush } from '@sentry/nextjs';
import type { NextPage, NextPageContext } from 'next';
import NextErrorComponent from 'next/error';
import type { ErrorProps } from 'next/error';
import { ErrorPage } from '@/features/system/pages';

const sentryIgnoredStatusCodes: number[] = [404, 410];

// Adds HttpException to the list of possible error types.
type AugmentedError = NonNullable<NextPageContext['err']> | null;
type CustomErrorProps = {
  err?: AugmentedError;
  message?: string;
  sentryErrorId?: string;
  hasGetInitialPropsRun?: boolean;
} & Omit<ErrorProps, 'err'>;

type AugmentedNextPageContext = Omit<NextPageContext, 'err'> & {
  err: AugmentedError;
};

/**
 * The request to sentry might be blocked on the browser due to ad blockers, csrf...
 * Alternatively a good practice is to proxy the sentry in a nextjs api route, istio...
 * @see https://github.com/getsentry/sentry-javascript/issues/2916
 */
const sentryCaptureExceptionFailsafe = (err: Error | string): string | undefined => {
  let browserSentryErrorId: string | undefined;
  try {
    browserSentryErrorId = sentryCaptureException(err);
  } catch (e) {
    const msg = `Couldn't send error to sentry, reason ${
      e instanceof Error ? e.message : 'unknown'
    }`;
    console.error(msg);
  }
  return browserSentryErrorId;
};

/**
 * Flushing the request on the browser is not required and might fail with err:BLOCKED_BY_CLIENT
 * Possible causes vary, but the most common is that the request is blocked by ad-blockers or csrf rules.
 */
const sentryFlushServerSide = async (flushAfter: number) => {
  if (typeof window === 'undefined') {
    try {
      await sentryFlush(flushAfter);
    } catch (e) {
      const msg = `Couldn't flush sentry, reason ${e instanceof Error ? e.message : 'unknown'}`;
      console.error(msg);
    }
  }
};

const CustomError: NextPage<CustomErrorProps> = (props) => {
  const { statusCode, err, hasGetInitialPropsRun, sentryErrorId, message } = props;

  let browserSentryErrorId: string | undefined;

  if (!hasGetInitialPropsRun && err) {
    // getInitialProps is not called in case of https://github.com/vercel/next.js/issues/8592.
    // As a workaround, we pass err via _app.js so it can be captured
    browserSentryErrorId = sentryCaptureExceptionFailsafe(err);
    // Flushing is not required in this case as it only happens on the client
  }
  return (
    <ErrorPage
      error={err ?? undefined}
      message={message}
      errorId={sentryErrorId ?? browserSentryErrorId}
      statusCode={statusCode}
    />
  );
};

CustomError.getInitialProps = async ({ res, err, asPath }: AugmentedNextPageContext) => {
  const errorInitialProps = (await NextErrorComponent.getInitialProps({
    res,
    err,
  } as NextPageContext)) as CustomErrorProps;

  // Workaround for https://github.com/vercel/next.js/issues/8592, mark when
  // getInitialProps has run
  errorInitialProps.hasGetInitialPropsRun = true;

  // Returning early because we don't want to log ignored errors to Sentry.
  if (typeof res?.statusCode === 'number' && sentryIgnoredStatusCodes.includes(res.statusCode)) {
    return errorInitialProps;
  }

  // Running on the server, the response object (`res`) is available.
  //
  // Next.js will pass an error on the server if a page's data fetching methods
  // threw or returned a Promise that rejected
  //
  // Running on the client (browser), Next.js will provide an error if:
  //
  //  - a page's `getInitialProps` threw or returned a Promise that rejected
  //  - an exception was thrown somewhere in the React lifecycle (render,
  //    componentDidMount, etc) that was caught by Next.js's React Error
  //    Boundary. Read more about what types of exceptions are caught by Error
  //    Boundaries: https://reactjs.org/docs/error-boundaries.html

  if (err) {
    errorInitialProps.sentryErrorId = sentryCaptureExceptionFailsafe(err);
    // Flushing before returning is necessary if deploying to Vercel, see
    // https://vercel.com/docs/platform/limits#streaming-responses
    await sentryFlushServerSide(1_500);
    return errorInitialProps;
  }

  // If this point is reached, getInitialProps was called without any
  // information about what the error might be. This is unexpected and may
  // indicate a bug introduced in Next.js, so record it in Sentry
  errorInitialProps.sentryErrorId = sentryCaptureException(
    new Error(`_error.js getInitialProps missing data at path: ${asPath}`)
  );
  await sentryFlushServerSide(1_500);
  return errorInitialProps;
};

export default CustomError;
