import { Hydrate, QueryClientProvider as TanStackQueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from './i18n';
import { createQueryClient } from './queryClient';

interface IQueryClientProviderProps {
  dehydratedState?: unknown;
  children: React.ReactNode;
}

export const QueryClientProvider = (props: IQueryClientProviderProps) => {
  const { dehydratedState, children } = props;
  const { t } = useTranslation();
  const [queryClient] = useState(() => createQueryClient(t));

  return (
    <TanStackQueryClientProvider client={queryClient}>
      <Hydrate state={dehydratedState}>{children}</Hydrate>
    </TanStackQueryClientProvider>
  );
};
