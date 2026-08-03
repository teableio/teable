import type { GetServerSideProps, InferGetServerSidePropsType } from 'next';

type Props = {
  hasRunOnServer: boolean;
};

export default function MonitorSentrySsrRoute(
  _props: InferGetServerSidePropsType<typeof getServerSideProps>
) {
  return (
    <div>
      <h1>Unexpected error</h1>
      <p>
        If you see this message, it means that the an error thrown in the `getServerSideProps()`
        function wasn't caught by the global error handler (pages/_error.tsx). This is a bug in the
        application and may affect the ability to display error pages and log errors on Sentry. See
        the monitoring page in /pages/_monitor/sentry/ssr-page.tsx.
      </p>
    </div>
  );
}

/**
 * Always throws an error on purpose for monitoring
 */
export const getServerSideProps: GetServerSideProps<Props> = async (_context) => {
  throw new Error(
    'Error purposely crafted for monitoring sentry (/pages/_monitor/sentry/ssr-page.tsx)'
  );
};
