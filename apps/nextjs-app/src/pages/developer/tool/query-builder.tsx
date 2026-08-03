import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import React from 'react';
import { QueryBuilder } from '@/features/app/blocks/setting/query-builder/QueryBuilder';
import { SettingLayout } from '@/features/app/layouts/SettingLayout';
import { developerConfig } from '@/features/i18n/developer.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const QueryBuilderPage: NextPageWithLayout = () => {
  return <QueryBuilder />;
};
export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context) => {
      return {
        props: {
          ...(await getTranslationsProps(context, developerConfig.i18nNamespaces)),
        },
      };
    })
  )
);

QueryBuilderPage.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SettingLayout {...pageProps}>{page}</SettingLayout>;
};

export default QueryBuilderPage;
