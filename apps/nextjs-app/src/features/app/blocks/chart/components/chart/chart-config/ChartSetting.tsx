import { cn, ScrollArea } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useContext } from 'react';
import { ChartContext } from '../../ChartProvider';
import { ChartForm } from './ChartForm';
import { ConfigItem } from './common/ConfigItem';
import { QueryStatus } from './QueryStatus';
import { TypeSelector } from './TypeSelector';

export const ChartSetting = (props: { className?: string }) => {
  const { className } = props;
  const { storage, onStorageChange } = useContext(ChartContext);
  const { t } = useTranslation('chart');
  const config = storage?.config;
  if (!storage) {
    return;
  }

  return (
    <ScrollArea className={cn('border-l p-4 w-80', className)}>
      <QueryStatus />
      <div className="mt-9 space-y-4">
        <ConfigItem label={t('form.chartType.label')}>
          <TypeSelector
            type={config?.type}
            onChange={(type) =>
              onStorageChange({
                ...storage,
                config: { type },
              })
            }
          />
        </ConfigItem>
        <div>
          {config && (
            <ChartForm
              value={config}
              onChange={(config) => {
                onStorageChange({
                  ...storage,
                  config,
                });
              }}
            />
          )}
        </div>
      </div>
    </ScrollArea>
  );
};
