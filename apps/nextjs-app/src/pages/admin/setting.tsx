import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import type { ISettingPageProps } from '@/features/app/blocks/admin';
import { SettingPage } from '@/features/app/blocks/admin';
import { AdminLayout } from '@/features/app/layouts/AdminLayout';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';

const Setting: NextPageWithLayout<ISettingPageProps> = ({ settingServerData }) => (
  <SettingPage settingServerData={settingServerData} />
);

export const getServerSideProps: GetServerSideProps = withAuthSSR(async (context, ssrApi) => {
  const userMe = await ssrApi.getUserMe();

  if (!userMe?.isAdmin) {
    return {
      redirect: {
        destination: '/403',
        permanent: false,
      },
    };
  }

  const setting = await ssrApi.getSetting();
  return {
    props: {
      settingServerData: setting,
      ...(await getTranslationsProps(context, 'common')),
    },
  };
});

Setting.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <AdminLayout {...pageProps}>{page}</AdminLayout>;
};

export default Setting;
