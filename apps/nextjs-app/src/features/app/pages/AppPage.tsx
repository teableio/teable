import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import dynamic from 'next/dynamic';
import type { FC } from 'react';
import { appConfig } from '../app.config';
import Doc from '../components/DocEditor';
import { SideMenu } from '../components/SideMenu';
import { AppLayout } from '../layouts';
import { useAppStore } from '../store';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const DataGrid = dynamic<any>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async (): Promise<any> => {
    const grid = await import('../components/DataGrid');
    return grid.DataGrid;
  },
  { ssr: false }
);

export const AppPage: FC = () => {
  const { t } = useTranslation(appConfig.i18nNamespaces);
  const currentFile = useAppStore((state) => state.currentFile);
  return (
    <>
      <NextSeo
        title={t('app:page.title')}
        description="Web-app nextjs monorepo example, https://github.com/teable-group/teable"
      />
      <AppLayout>
        <div className="h-full flex items-start fixed w-full">
          <div className="max-w-xs w-full h-full bg-gray-50">
            <SideMenu />
          </div>
          <div className="grow-1 h-screen w-full m-4 overflow-y-auto">
            {currentFile?.name.endsWith('.md') ? (
              <Doc path={currentFile.path} />
            ) : (
              <DataGrid />
            )}
          </div>
        </div>
      </AppLayout>
    </>
  );
};
