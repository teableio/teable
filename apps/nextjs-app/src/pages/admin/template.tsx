import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import type { ISettingPageProps } from '@/features/app/blocks/admin';
import { TemplatePage } from '@/features/app/blocks/admin';
import { AdminLayout } from '@/features/app/layouts/AdminLayout';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const TemplateAdmin: NextPageWithLayout<ISettingPageProps> = () => <TemplatePage />;

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR(async (context, ssrApi) => {
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
    })
  )
);

TemplateAdmin.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <AdminLayout {...pageProps}>{page}</AdminLayout>;
};

export default TemplateAdmin;
