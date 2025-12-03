import { Plus, Trash2 } from '@teable/icons';
import { Button } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useBaseQueryData } from '../../../chart/hooks/useBaseQueryData';
import { useStorage } from '../../../hooks';
import { FormLabel } from '../FormLabel';
import { AddColumnButton } from './AddColumnButton';
import { ColumnSelect } from './ColumnSelect';

export const ColumnConfig = () => {
  const { t } = useTranslation('chart');
  const { columns = [] } = useBaseQueryData();
  const { updateStorageByPath, storage } = useStorage();
  const xAxis = storage?.config?.xAxis;
  const yAxis = storage?.config?.yAxis;
  const options = columns?.map((column) => ({
    value: column.name,
    label: column.name,
  }));

  const numberColumns = columns.filter((column) => column.isNumber);
  const numberColumnsOptions = numberColumns.map((column) => ({
    value: column.name,
    label: column.name,
  }));

  return (
    <div className="flex flex-col gap-2">
      <span className="text-md font-bold">{t('chartV2.form.axisConfig.title')}</span>

      <FormLabel label={t('chartV2.form.axisConfig.xAxis')}>
        <ColumnSelect
          options={options}
          value={xAxis}
          onSelect={(value: string) => {
            updateStorageByPath(`config.xAxis`, value);
          }}
        />
      </FormLabel>

      <FormLabel label={t('chartV2.form.axisConfig.yAxis')}>
        <>
          {yAxis?.map((item, index) => (
            <div className="flex gap-2" key={item}>
              <ColumnSelect
                className="flex-1"
                options={numberColumnsOptions}
                value={item}
                onSelect={(value: string) => {
                  updateStorageByPath(`config.yAxis[${index}]`, value);
                }}
              />

              <Button
                variant="outline"
                onClick={() => {
                  const newValue = [...yAxis];
                  newValue.splice(index, 1);
                  updateStorageByPath(`config.yAxis`, newValue);
                }}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <AddColumnButton>
            <Button variant="outline" className="gap-1">
              <div>{t('chartV2.form.sql.addSeries')}</div>
              <Plus className="size-4" />
            </Button>
          </AddColumnButton>
        </>
      </FormLabel>
    </div>
  );
};
