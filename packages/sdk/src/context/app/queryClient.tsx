import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import type { IHttpError } from '@teable-group/core';
import { toast } from '@teable-group/ui-lib';

export const createQueryClient = () => {
  const errorHandler = (error: unknown) => {
    const { code, message, status } = error as IHttpError;
    // no authentication
    if (status === 401) {
      window.location.href = `/auth/login?redirect=${encodeURIComponent(window.location.href)}`;
      return;
    }
    toast({
      variant: 'destructive',
      title: code || 'Unknown Error',
      description: message,
    });
  };
  return new QueryClient({
    queryCache: new QueryCache({
      onError: errorHandler,
    }),
    mutationCache: new MutationCache({
      onError: errorHandler,
    }),
  });
};
