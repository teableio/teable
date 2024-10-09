import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { OAuthAppPage } from '@/features/app/blocks/setting/oauth-app/OAuthAppPage';
import { SettingLayout } from '@/features/app/layouts/SettingLayout';
import { oauthAppConfig } from '@/features/i18n/oauth-app.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withEnv from '@/lib/withEnv';

const OAuthApp: NextPageWithLayout = () => {
  return <OAuthAppPage />;
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

OAuthApp.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SettingLayout {...pageProps}>{page}</SettingLayout>;
};

export default OAuthApp;
