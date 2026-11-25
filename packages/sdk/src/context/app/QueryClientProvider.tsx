import {
  HydrationBoundary,
  QueryClientProvider as TanStackQueryClientProvider,
  type DehydratedState,
} from '@tanstack/react-query';
import { useContext, useState } from 'react';
import { AppContext } from './AppContext';
import { useTranslation } from './i18n';
import { createQueryClient } from './queryClient';

interface IQueryClientProviderProps {
  dehydratedState?: DehydratedState;
  children: React.ReactNode;
}

export const QueryClientProvider = (props: IQueryClientProviderProps) => {
  const { dehydratedState, children } = props;
  const { t } = useTranslation();
  // A share page and a template preview say so through the app context their layout provides,
  // for as long as the page lives. A link view nested in a member's page replaces `shareId`
  // further down, below this client, so the member's page keeps the member's handling.
  const { template, shareId } = useContext(AppContext) ?? {};
  const [queryClient] = useState(() =>
    createQueryClient(t, { isReadOnlyPreview: Boolean(template || shareId) })
  );

  return (
    <TanStackQueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
    </TanStackQueryClientProvider>
  );
};
