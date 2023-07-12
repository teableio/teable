import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@teable-group/ui-lib/shadcn/ui/toaster';
import type { FC, PropsWithChildren } from 'react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
    },
  },
});

type Props = PropsWithChildren;

export const AppProviders: FC<Props> = (props) => {
  const { children } = props;
  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
};
