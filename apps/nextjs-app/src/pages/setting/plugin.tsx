import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { PluginPage } from '@/features/app/blocks/setting/plugin/PluginPage';
import { SettingLayout } from '@/features/app/layouts/SettingLayout';
import { settingPluginConfig } from '@/features/i18n/setting-plugin.config';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';

const Plugin: NextPageWithLayout = () => {
  return <PluginPage />;
};
export const getServerSideProps: GetServerSideProps = async (context) => {
  return {
    props: {
      ...(await getTranslationsProps(context, settingPluginConfig.i18nNamespaces)),
    },
  };
};

Plugin.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SettingLayout {...pageProps}>{page}</SettingLayout>;
};

export default Plugin;
