import { HeadContent, Outlet, Scripts, createRootRouteWithContext } from '@tanstack/react-router';
import { NuqsAdapter } from '@/lib/nuqs/tanstackRouterAdapter';
import { Toaster } from 'sonner';

import appCss from '../styles.css?url';
import { LogPanel } from '@/components/playground/LogPanel';

import type { QueryClient } from '@tanstack/react-query';

interface MyRouterContext {
  queryClient: QueryClient;
}

if (!import.meta.env.SSR) {
  void import('../integrations/otel/client').then((mod) => mod.initClientOtel());
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  head: () => ({
    meta: [
      {
        charSet: 'utf-8',
      },
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1',
      },
      {
        title: 'Teable Playground',
      },
    ],
    links: [
      {
        rel: 'stylesheet',
        href: appCss,
      },
      {
        rel: 'icon',
        type: 'image/svg+xml',
        href: '/favicon.svg',
      },
      {
        rel: 'icon',
        type: 'image/x-icon',
        href: '/favicon.ico',
      },
    ],
  }),

  shellComponent: RootDocument,
  component: () => (
    <NuqsAdapter>
      <Outlet />
      {/* Log panel for monitoring computed field updates and other backend logs */}
      {!import.meta.env.SSR && <LogPanel />}
    </NuqsAdapter>
  ),
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster
          position="top-center"
          richColors
          closeButton
          toastOptions={{
            classNames: {
              toast: 'bg-popover text-foreground border border-border shadow-sm',
              title: 'text-sm font-medium',
              description: 'text-xs text-muted-foreground',
            },
          }}
        />
        <Scripts />
      </body>
    </html>
  );
}
