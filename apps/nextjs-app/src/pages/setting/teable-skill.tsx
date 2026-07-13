import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import { TeableSkillPage } from '@/features/app/blocks/setting/teable-skill/TeableSkillPage';
import { SettingLayout } from '@/features/app/layouts/SettingLayout';
import { settingConfig } from '@/features/i18n/setting.config';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withEnv from '@/lib/withEnv';

const TeableSkill: NextPageWithLayout = () => {
  return <TeableSkillPage />;
};

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(async (context) => {
    return {
      props: {
        ...(await getTranslationsProps(context, settingConfig.i18nNamespaces)),
      },
    };
  })
);

TeableSkill.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <SettingLayout {...pageProps}>{page}</SettingLayout>;
};

export default TeableSkill;
