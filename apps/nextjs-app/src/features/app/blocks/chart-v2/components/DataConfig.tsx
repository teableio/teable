import { ChartType } from '@teable/openapi';
import { Input, Separator } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useStorage } from '../hooks';
import { usePluginInstall } from '../hooks/usePluginInstall';
import { ChartTypeSelect } from './form';
import { DataSourceSelect } from './form/DataSource';

export const DataConfig = () => {
  const { t } = useTranslation('chart');
  const { updateStorageByPath } = useStorage();
  const { renamePlugin, pluginInstall } = usePluginInstall();
  const { name: pluginName } = pluginInstall || {};
  const { storage } = useStorage();
  const { chartType } = storage;

  return (
    <div className="flex w-full flex-1 flex-col gap-2 overflow-auto py-4">
      <div className="flex flex-col gap-2 px-0.5">
        <span>{t('chartV2.form.name')}</span>
        <Input
          className="h-9"
          defaultValue={pluginName as string}
          onBlur={(e) => renamePlugin(e.target.value)}
        />
      </div>

      <ChartTypeSelect
        value={chartType}
        onChange={(type) => {
          const paths: Array<{ path: string; value: unknown }> = [
            { path: 'chartType', value: type as ChartType },
          ];
          if ([ChartType.Pie, ChartType.DonutChart].some((item) => item === (type as ChartType))) {
            paths.push({ path: 'query.groupBy', value: null });
            paths.push({ path: 'appearance.labelVisible', value: true });
          }
          updateStorageByPath(paths);
        }}
      />

      <Separator className="my-2" />

      <div className="flex flex-col gap-2">
        <span>{t('chartV2.form.dataSource.title')}</span>
        <DataSourceSelect />
      </div>
    </div>
  );
};
