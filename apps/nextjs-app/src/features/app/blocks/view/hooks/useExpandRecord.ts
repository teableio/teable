import { useRouter } from 'next/router';
import { useCallback } from 'react';

// expanding a record must go through the url, otherwise the expanded record is
// not linkable (copy record url would return the bare view url)
export const useExpandRecord = () => {
  const router = useRouter();

  return useCallback(
    async (recordId: string) => {
      await router.push(
        {
          pathname: router.pathname,
          query: { ...router.query, recordId },
        },
        undefined,
        {
          shallow: true,
        }
      );
    },
    [router]
  );
};
