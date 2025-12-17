import type { DehydratedState } from '@tanstack/react-query';
import type { NextPage } from 'next';
import type { SSRConfig } from 'next-i18next';
import type { ReactElement, ReactNode } from 'react';

export type IBasePageProps = SSRConfig & {
  dehydratedState?: DehydratedState;
  [p: string]: unknown;
};

export type NextPageWithLayout<P = Record<string, unknown>, IP = P> = NextPage<P, IP> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLayout?: (page: ReactElement, appProps: any) => ReactNode;
};
