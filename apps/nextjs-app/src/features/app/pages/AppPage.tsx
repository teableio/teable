import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import type { FC } from 'react';
import { appConfig } from '../app.config';
import { SideMenu } from '../components/SideMenu';
import { AppLayout } from '../layouts';

export const AppPage: FC = () => {
  const { t } = useTranslation(appConfig.i18nNamespaces);

  return (
    <>
      <NextSeo
        title={t('app:page.title')}
        description="Web-app nextjs monorepo example, https://github.com/teable-group/teable"
      />
      <AppLayout>
        <div className="h-full flex items-start fixed w-full">
          <div className="max-w-xs w-full h-full">
            <SideMenu />
          </div>
          <div className="grow-1 h-screen w-full m-4 bg-gray-100 text-center">
            表格区域
          </div>
        </div>
      </AppLayout>
    </>
  );
};
