import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { PersonAccessTokenPage } from '@/features/app/blocks/setting/access-token/PersonAccessTokenPage';
import { SettingLayout } from '@/features/app/layouts/SettingLayout';
import { personalAccessTokenConfig } from '@/features/i18n/personal-access-token.config';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '../_app';

const PersonalAccessToken: NextPageWithLayout = () => {
  return <PersonAccessTokenPage />;
};
export const getServerSideProps: GetServerSideProps = async (context) => {
  return {
    props: {
      ...(await getTranslationsProps(context, personalAccessTokenConfig.i18nNamespaces)),
    },
  };
};

PersonalAccessToken.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SettingLayout {...pageProps}>{page}</SettingLayout>;
};

export default PersonalAccessToken;
