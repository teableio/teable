import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import dynamic from 'next/dynamic';
import type { FC } from 'react';
import { appConfig } from '../app.config';
import Doc from '../components/DocEditor';
import { SideMenu } from '../components/SideMenu';
import { AppLayout } from '../layouts';
import { useAppStore } from '../store';

export const DataGrid = dynamic(
  async () => {
    const grid = await import('../components/DataGrid');
    return grid.DataGrid;
  },
  { ssr: false }
);

const AppSwitch: FC<{ path?: string }> = ({ path }) => {
  const setSelectPath = useAppStore((state) => state.setSelectPath);

  const openDirSelector = async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const path = await (window as any).electronAPI.openFile();
    setSelectPath(path);
  };
  if (path?.includes('.teable#')) {
    return <DataGrid path={path} />;
  }
  if (path?.endsWith('.md')) {
    return <Doc path={path} />;
  }
  // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
  return <div onClick={openDirSelector}>open .md or .teable file</div>;
};
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
          <div className="max-w-xs w-full h-full bg-gray-50 overflow-y-auto">
            <SideMenu />
          </div>
          <div className="grow-1 h-screen w-full m-4 overflow-y-auto">
            <AppSwitch path={currentFile?.path} />
          </div>
        </div>
      </AppLayout>
    </>
  );
};
