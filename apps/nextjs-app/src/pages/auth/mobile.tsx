import type { GetServerSideProps } from 'next';
import { TranslatedQueryClientProvider } from '@/features/app/components/TranslatedQueryClientProvider';
import type { IMobileSignInPageProps } from '@/features/auth/pages/mobile-sign-in.server';
import { getMobileSignInServerSideProps } from '@/features/auth/pages/mobile-sign-in.server';
import { MobileSignInPage } from '@/features/auth/pages/MobileSignInPage';
import withEnv from '@/lib/withEnv';

export default function MobileSignInRoute(props: Readonly<IMobileSignInPageProps>) {
  return (
    <TranslatedQueryClientProvider>
      <MobileSignInPage {...props} />
    </TranslatedQueryClientProvider>
  );
}

export const getServerSideProps: GetServerSideProps<IMobileSignInPageProps> = withEnv(
  getMobileSignInServerSideProps
);
