import {
  HydrationBoundary,
  QueryClientProvider as TanStackQueryClientProvider,
  type DehydratedState,
} from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from './i18n';
import { createQueryClient } from './queryClient';

interface IQueryClientProviderProps {
  dehydratedState?: DehydratedState;
  children: React.ReactNode;
}

export const QueryClientProvider = (props: IQueryClientProviderProps) => {
  const { dehydratedState, children } = props;
  const { t } = useTranslation();
  const [queryClient] = useState(() => createQueryClient(t));

  return (
    <TanStackQueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
    </TanStackQueryClientProvider>
  );
};
