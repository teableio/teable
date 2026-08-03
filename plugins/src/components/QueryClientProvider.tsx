'use client';
import type { DehydratedState } from '@tanstack/react-query';
import {
  QueryClientProvider as _QueryClientProvider,
  HydrationBoundary,
} from '@tanstack/react-query';
import * as React from 'react';
import { getQueryClient } from './get-query-client';

export default function QueryClientProvider({
  children,
  dehydratedState,
}: {
  children: React.ReactNode;
  dehydratedState?: DehydratedState;
}) {
  const queryClient = getQueryClient();

  return (
    <_QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
    </_QueryClientProvider>
  );
}
