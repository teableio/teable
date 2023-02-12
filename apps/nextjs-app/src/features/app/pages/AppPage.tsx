import { useTranslation } from 'next-i18next';
import { NextSeo } from 'next-seo';
import dynamic from 'next/dynamic';
import type { FC } from 'react';
import { useLocalstorageState } from 'rooks';
import { appConfig } from '../app.config';
import { DemoGrid } from '../components/DemoGrid';
import { DemoGridSchema } from '../components/DemoSchema';
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
  const [tableId, setTableId] = useLocalstorageState('teable_table_id', '');
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
            Teable Technical Preview
            <input value={tableId} onChange={(e) => setTableId(e.target.value)} />
          </div>
          <div className="grow-1 h-screen w-full m-4 overflow-y-auto">
            <DemoGridSchema tableId={tableId}>
              {(tableId, columns, connection) => (
                <DemoGrid tableId={tableId} columns={columns} connection={connection} />
              )}
            </DemoGridSchema>
          </div>
        </div>
      </AppLayout>
    </>
  );
};
