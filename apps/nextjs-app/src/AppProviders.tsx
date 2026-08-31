import { ThemeProvider } from '@teable/next-themes';
import { isRtlLang } from '@teable/sdk/utils';
import { ConfirmModalProvider, UiDirectionProvider } from '@teable/ui-lib';
import { Toaster as SoonerToaster } from '@teable/ui-lib/shadcn/ui/sonner';
import { Toaster } from '@teable/ui-lib/shadcn/ui/toaster';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from 'next-i18next';
import type { FC, PropsWithChildren } from 'react';
import type { IServerEnv } from './lib/server-env';
import { EnvContext } from './lib/server-env';
import { installThirdPartyDomGuard } from './lib/third-party-dom-guard';

// At module load, before React's first commit: every app entry (community and
// EE alike) pulls in AppProviders, so this is the one shared spot where the
// whole client is covered.
installThirdPartyDomGuard();

type Props = PropsWithChildren;

export const AppProviders: FC<Props & { env: IServerEnv }> = (props) => {
  const { children, env } = props;
  const searchParams = useSearchParams();
  const theme = searchParams?.get('theme') ?? undefined;
  // Radix primitives read direction from JS, not from the inherited `dir`, so
  // they need the same answer `_document` gave <html>. Both sides derive it
  // from the server locale, which keeps SSR and hydration in agreement.
  const { i18n } = useTranslation();
  const dir = !env.rtlUiDisabled && isRtlLang(i18n.language) ? 'rtl' : 'ltr';

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
        <UiDirectionProvider dir={dir}>
          <ConfirmModalProvider>
            {children}
            <Toaster />
            <SoonerToaster />
          </ConfirmModalProvider>
        </UiDirectionProvider>
      </EnvContext.Provider>
    </ThemeProvider>
  );
};
