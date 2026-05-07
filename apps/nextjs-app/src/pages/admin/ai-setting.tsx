import type { GetServerSideProps } from 'next';
import type { ReactElement } from 'react';
import type { IAISettingPageProps } from '@/features/app/blocks/admin/setting/AISettingPage';
import { AISettingPage } from '@/features/app/blocks/admin/setting/AISettingPage';
import { AdminLayout } from '@/features/app/layouts/AdminLayout';
import ensureLogin from '@/lib/ensureLogin';
import { getTranslationsProps } from '@/lib/i18n';
import type { NextPageWithLayout } from '@/lib/type';
import withAuthSSR, { ForbiddenError } from '@/lib/withAuthSSR';
import withEnv from '@/lib/withEnv';

const AISetting: NextPageWithLayout<IAISettingPageProps> = ({ settingServerData }) => (
  <AISettingPage settingServerData={settingServerData} />
);

export const getServerSideProps: GetServerSideProps = withEnv(
  ensureLogin(
    withAuthSSR<IAISettingPageProps>(async (context, ssrApi) => {
      const userMe = await ssrApi.getUserMe();

      if (!userMe?.isAdmin) {
        throw new ForbiddenError();
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

AISetting.getLayout = function getLayout(page: ReactElement, pageProps) {
  return <AdminLayout {...pageProps}>{page}</AdminLayout>;
};

export default AISetting;
