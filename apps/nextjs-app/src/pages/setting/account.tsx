import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { Account } from '@/features/app/components/setting/Account';
import { SettingLayout } from '@/features/app/layouts/SettingLayout';
import { settingAccountConfig } from '@/features/i18n/setting-account.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withEnv from '@/lib/withEnv';

/**
 * The profile / security tab of the settings dialog as a page of its own. The native mobile
 * app opens it from its settings screen: both stores require that a user can reach their
 * account and start its deletion from inside the app, and "Delete account" lives here.
 */
const AccountSetting: NextPageWithLayout = () => {
  return <Account />;
};

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(async (context) => {
    return {
      props: {
        ...(await getTranslationsProps(context, settingAccountConfig.i18nNamespaces)),
      },
    };
  })
);

AccountSetting.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SettingLayout {...pageProps}>{page}</SettingLayout>;
};

export default AccountSetting;
