import type { EmotionCache } from '@emotion/react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from 'next-auth';
import { SessionProvider } from 'next-auth/react';
import type { FC, PropsWithChildren } from 'react';

import { muiTheme } from '@/themes/mui/mui.theme';

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
  /**
   * Optional emotion/cache to use
   */
  emotionCache?: EmotionCache;
}>;

export const AppProviders: FC<Props> = (props) => {
  const { children, session } = props;
  return (
    <SessionProvider session={session} refetchInterval={0}>
      <MuiThemeProvider theme={muiTheme}>
        {/* Mui CssBaseline disabled in this example as tailwind provides its own */}
        {/* <CssBaseline /> */}
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      </MuiThemeProvider>
    </SessionProvider>
  );
};
