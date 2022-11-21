import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import type { FC, PropsWithChildren } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

type Props = PropsWithChildren<{
  /**
   * next-auth session
   */
  session?: Session | null;
}>;

export const AppProviders: FC<Props> = (props) => {
  const { children, session } = props;
  return (
    <SessionProvider session={session} refetchInterval={0}>
      {/* Mui CssBaseline disabled in this example as tailwind provides its own */}
      {/* <CssBaseline /> */}
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </SessionProvider>
  );
};
