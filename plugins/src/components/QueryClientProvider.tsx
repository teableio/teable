'use client';
import type { QueryClient } from '@tanstack/react-query';
import { QueryClientProvider as _QueryClientProvider, isServer } from '@tanstack/react-query';
import { createQueryClient } from '@teable/sdk';
import * as React from 'react';

function makeQueryClient() {
  return createQueryClient();
}

let browserQueryClient: QueryClient | undefined = undefined;

export function getQueryClient() {
  if (isServer) {
    // Server: always make a new query client
    return makeQueryClient();
  } else {
    // Browser: make a new query client if we don't already have one
    // This is very important, so we don't re-make a new client if React
    // suspends during the initial render. This may not be needed if we
    // have a suspense boundary BELOW the creation of the query client
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

export default function QueryClientProvider({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();

  return <_QueryClientProvider client={queryClient}>{children}</_QueryClientProvider>;
}
