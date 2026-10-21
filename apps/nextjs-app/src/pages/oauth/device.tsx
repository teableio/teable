import type { IUser } from '@teable/sdk/context';
import { AppProvider, SessionProvider } from '@teable/sdk/context';
import type { GetServerSideProps } from 'next';
import { useTranslation } from 'next-i18next';
import type { ReactElement } from 'react';
import { OAuthDevicePage } from '@/features/app/blocks/setting/oauth-app/OAuthDevicePage';
import { useSdkLocale } from '@/features/app/hooks/useSdkLocale';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withEnv from '@/lib/withEnv';

const OAuthDevice: NextPageWithLayout = () => {
  return <OAuthDevicePage />;
};

const OAuthDeviceLayout = ({ children, user }: { children: React.ReactNode; user?: IUser }) => {
  const sdkLocale = useSdkLocale();
  const { i18n } = useTranslation();

  return (
    // disabledWs: an approval screen has nothing to subscribe to.
    <AppProvider disabledWs lang={i18n.language} locale={sdkLocale}>
      <SessionProvider user={user}>{children}</SessionProvider>
    </AppProvider>
  );
};

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(async (context) => {
    return {
      props: {
        ...(await getTranslationsProps(context, oauthAppConfig.i18nNamespaces)),
      },
    };
  })
);

OAuthDevice.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <OAuthDeviceLayout {...pageProps}>{page}</OAuthDeviceLayout>;
};

export default OAuthDevice;
