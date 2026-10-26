import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@teable/sdk/context';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';

/**
 * Query client for standalone pages that render without AppProvider (sign-in, share auth,
 * artifact). Without the translator the error toast shows the raw code and the server's English
 * message even when the response carries a localization. The page must load the `sdk` namespace.
 */
export const TranslatedQueryClientProvider = ({ children }: { children: React.ReactNode }) => {
  const { t } = useTranslation('sdk');
  const [queryClient] = useState(() => createQueryClient(t));

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};
