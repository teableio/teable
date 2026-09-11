import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@teable/sdk/context';
import type { GetServerSideProps } from 'next';
import { useState } from 'react';
import type { IMobileSignInPageProps } from '@/features/auth/pages/mobile-sign-in.server';
import { getMobileSignInServerSideProps } from '@/features/auth/pages/mobile-sign-in.server';
import { MobileSignInPage } from '@/features/auth/pages/MobileSignInPage';
import withEnv from '@/lib/withEnv';

export default function MobileSignInRoute(props: IMobileSignInPageProps) {
  const [queryClient] = useState(() => createQueryClient());

  return (
    <QueryClientProvider client={queryClient}>
      <MobileSignInPage {...props} />
    </QueryClientProvider>
  );
}

export const getServerSideProps: GetServerSideProps<IMobileSignInPageProps> = withEnv(
  getMobileSignInServerSideProps
);
