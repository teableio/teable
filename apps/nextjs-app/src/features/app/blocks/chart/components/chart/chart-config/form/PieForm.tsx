import { Settings } from '@teable/icons';
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useBaseQueryData } from '../../../../hooks/useBaseQueryData';
import { useFilterNumberColumns } from '../../../../hooks/useFilterNumberColumns';
import type { IPieConfig } from '../../../../types';
import { ColumnSelector } from '../common/ColumnSelector';
import { ConfigItem } from '../common/ConfigItem';
import { PaddingEditor } from '../common/PaddingEditor';
import { SwitchEditor } from '../common/SwitchEditor';

export const PieForm = (props: { config: IPieConfig; onChange: (config: IPieConfig) => void }) => {
  const { config, onChange } = props;
  const { t } = useTranslation('chart');
  const baseQueryData = useBaseQueryData();
  const xColumns = baseQueryData?.columns ?? [];
  const yColumns = useFilterNumberColumns(baseQueryData?.columns);
  const [decimal, setDecimal] = useState<number | undefined>(config.measure?.decimal);
  const [prefix, setPrefix] = useState<string | undefined>(config.measure?.prefix);
  const [suffix, setSuffix] = useState<string | undefined>(config.measure?.suffix);
  return (
    <div className="space-y-4">
      <ConfigItem label={t('form.pie.dimension')}>
        <ColumnSelector
          value={config.dimension}
          onChange={(val) => {
            onChange({ ...config, dimension: val });
          }}
          columns={xColumns}
        />
      </ConfigItem>
      <ConfigItem label={t('form.pie.measure')}>
        <div className="flex items-center gap-2 ">
          <ColumnSelector
            className="flex-1"
            value={config.measure?.column}
            onChange={(val) => {
              onChange({
                ...config,
                measure: {
                  ...config.measure,
                  column: val,
                },
              });
            }}
            columns={yColumns}
          />
          {config.measure && config.measure.column && (
            <Popover>
              <PopoverTrigger asChild>
                <Button size="xs" variant={'outline'}>
                  <Settings />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="space-y-4">
                <ConfigItem label={t('form.decimal')}>
                  <Input
                    className="h-7 text-[13px]"
                    type="number"
                    step={1}
                    value={decimal ?? ''}
                    onBlur={() => {
                      const newValue = decimal ? Math.max(0, Math.min(decimal, 10)) : undefined;

                      onChange({
                        ...config,
                        measure: {
                          ...config.measure!,
                          decimal: newValue,
                        },
                      });
                      setDecimal(newValue);
                    }}
                    onChange={(e) => {
                      const number = parseInt(e.target.value);
                      setDecimal(isNaN(number) ? undefined : number);
                    }}
                  />
                </ConfigItem>
                <ConfigItem label={t('form.prefix')}>
                  <Input
                    className="h-7 text-[13px]"
                    value={prefix ?? ''}
                    onBlur={() => {
                      onChange({
                        ...config,
                        measure: {
                          ...config.measure!,
                          prefix,
                        },
                      });
                    }}
                    onChange={(e) => {
                      setPrefix(e.target.value);
                    }}
                  />
                </ConfigItem>
                <ConfigItem label={t('form.suffix')}>
                  <Input
                    className="h-7 text-[13px]"
                    value={suffix ?? ''}
                    onBlur={() => {
                      onChange({
                        ...config,
                        measure: {
                          ...config.measure!,
                          suffix,
                        },
                      });
                    }}
                    onChange={(e) => {
                      setSuffix(e.target.value);
                    }}
                  />
                </ConfigItem>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </ConfigItem>
      <SwitchEditor
        label={t('form.showLabel')}
        value={config.showLabel}
        onChange={(val) => {
          onChange({
            ...config,
            showLabel: val,
          });
        }}
      />
      <SwitchEditor
        label={t('form.pie.showTotal')}
        value={config.showTotal}
        onChange={(val) => {
          onChange({
            ...config,
            showTotal: val,
          });
        }}
      />
      <SwitchEditor
        label={t('form.showLegend')}
        value={config.showLegend}
        onChange={(val) => {
          onChange({
            ...config,
            showLegend: val,
          });
        }}
      />
      <ConfigItem label={t('form.padding.label')}>
        <PaddingEditor
          value={config.padding}
          onChange={(val) => {
            onChange({
              ...config,
              padding: val,
            });
          }}
        />
      </ConfigItem>
    </div>
  );
};
