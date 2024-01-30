import type { NextPage } from 'next';
import type { ReactElement, ReactNode } from 'react';

export type NextPageWithLayout<P = Record<string, unknown>, IP = P> = NextPage<P, IP> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLayout?: (page: ReactElement, appProps: any) => ReactNode;
};
