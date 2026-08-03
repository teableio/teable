import { ThemeProvider } from '@teable/next-themes';
import { ConfirmModalProvider } from '@teable/ui-lib';
import { Toaster as SoonerToaster } from '@teable/ui-lib/shadcn/ui/sonner';
import { Toaster } from '@teable/ui-lib/shadcn/ui/toaster';
import { useSearchParams } from 'next/navigation';
import type { FC, PropsWithChildren } from 'react';
import type { IServerEnv } from './lib/server-env';
import { EnvContext } from './lib/server-env';

type Props = PropsWithChildren;

export const AppProviders: FC<Props & { env: IServerEnv }> = (props) => {
  const { children, env } = props;
  const searchParams = useSearchParams();
  const theme = searchParams?.get('theme') ?? undefined;

  return (
    <ThemeProvider
      attribute="class"
      themeColor={{
        light: '#ffffff',
        dark: '#09090b',
      }}
      forcedTheme={theme}
    >
      <EnvContext.Provider value={env}>
        <ConfirmModalProvider>
          {children}
          <Toaster />
          <SoonerToaster />
        </ConfirmModalProvider>
      </EnvContext.Provider>
    </ThemeProvider>
  );
};
