import Head from 'next/head';
import type { FC } from 'react';

type Props = {
  statusCode?: number | null;
  error?: Error;
  message?: string;
  errorId?: string;
  children?: never;
};

export const ErrorPage: FC<Props> = (props) => {
  const { error, errorId, message, statusCode } = props;

  return (
    <>
      <Head>
        <title>Error {statusCode}</title>
      </Head>
      <div className="container bg-white text-2xl md:text-xl">
        <div className="size-screen flex flex-col items-center justify-center">
          <h1 className="m-5 text-5xl text-black md:text-4xl">Woops !</h1>
          <p className="text-2xl text-black md:text-2xl">
            Something went wrong. Please try again later.
          </p>
        </div>
        <div className="absolute bottom-0 right-0 m-5 rounded-lg border-2 border-solid border-indigo-400 p-5 text-left text-sm text-gray-700">
          <p data-testid="error-status-code">Code: {statusCode}</p>
          <p>Message: {message}</p>
          <p>Error id: {errorId}</p>
          <p>ErrorMessage: {error?.message}</p>
        </div>
      </div>
    </>
  );
};
