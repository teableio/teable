import { QueryCache, QueryClient } from '@tanstack/react-query';
import type { IHttpError } from '@teable-group/core';
import { useToast } from '@teable-group/ui-lib';
import { useEffect, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getQueryClient = (toast: any) => {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error: unknown) => {
        const { code, message, status } = error as IHttpError;
        // no authentication
        if (status === 401) {
          window.location.href = `/auth/login?redirect=${encodeURIComponent(
            window.location.pathname + window.location.search
          )}`;
          return;
        }
        toast({
          variant: 'destructive',
          title: code || 'Unknown Error',
          description: message,
        });
      },
    }),
  });
};

export const useQueryClient = () => {
  const { toast } = useToast();
  const [queryClient, setQueryClient] = useState<QueryClient>(getQueryClient(toast));

  useEffect(() => {
    setQueryClient(getQueryClient(toast));
  }, [toast]);

  return queryClient;
};
