import { Settings, X } from '@teable/icons';
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import { useBaseQueryData } from '../../../../hooks/useBaseQueryData';
import { useFilterNumberColumns } from '../../../../hooks/useFilterNumberColumns';
import { AxisDisplayBaseContent } from '../common/AxisDisplayBaseContent';
import { ColumnSelector } from '../common/ColumnSelector';
import { ConfigItem } from '../common/ConfigItem';
import type { ComboYAxis } from './utils';

export const ComboYAxisEditor = (props: {
  value: ComboYAxis;
  selectedColumns: string[];
  onChange: (value: ComboYAxis) => void;
  onDelete: () => void;
  hiddenDelete?: boolean;
}) => {
  const { value, selectedColumns, onChange, onDelete, hiddenDelete } = props;

  const baseQueryData = useBaseQueryData();
  const allColumns = useFilterNumberColumns(baseQueryData?.columns ?? []);

  const columns = allColumns.filter(
    ({ column }) => column === value.column || !selectedColumns.includes(column)
  );

  const displayValue = value?.display;
  const onChangeConfig = (config: Omit<ComboYAxis, 'column'>) => {
    if (!value) {
      return;
    }
    onChange({
      ...value,
      decimal: config.decimal,
      prefix: config.prefix,
      suffix: config.suffix,
      display: config.display,
      label: config.label,
    });
  };

  return (
    <div className="relative flex items-center gap-2">
      <ColumnSelector
        className="flex-1"
        value={value?.column}
        onChange={(yAxisCol) =>
          onChange({
            ...value,
            column: yAxisCol,
          })
        }
        columns={columns}
      />
      {value?.column && displayValue && (
        <YAxisConfigEditor value={value} onChange={onChangeConfig} />
      )}
      {!hiddenDelete && (
        <Button size="xs" variant="outline" onClick={onDelete}>
          <X />
        </Button>
      )}
    </div>
  );
};

const YAxisConfigEditor = (props: {
  className?: string;
  value: Omit<ComboYAxis, 'column'>;
  onChange: (value: Omit<ComboYAxis, 'column'>) => void;
}) => {
  const { value, onChange, className } = props;
  const { t } = useTranslation('chart');
  const [suffix, setSuffix] = useState(value.suffix);
  const [prefix, setPrefix] = useState(value.prefix);
  const [decimal, setDecimal] = useState(value.decimal);
  const [label, setLabel] = useState(value.label);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button className={className} size="xs" variant={'outline'}>
          <Settings />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-64 space-y-4 overflow-auto">
        <AxisDisplayBaseContent
          value={value.display}
          onChange={(val) => {
            onChange({ ...value, display: val });
          }}
        />
        <ConfigItem label={t('form.label')}>
          <Input
            className="h-7 text-[13px]"
            value={label || ''}
            onBlur={() => onChange({ ...value, label })}
            onChange={(e) => setLabel(e.target.value)}
          />
        </ConfigItem>
        <ConfigItem label={t('form.prefix')}>
          <Input
            className="h-7 text-[13px]"
            value={prefix || ''}
            onBlur={() => onChange({ ...value, prefix })}
            onChange={(e) => setPrefix(e.target.value)}
          />
        </ConfigItem>
        <ConfigItem label={t('form.suffix')}>
          <Input
            className="h-7 text-[13px]"
            value={suffix || ''}
            onBlur={() => onChange({ ...value, suffix })}
            onChange={(e) => setSuffix(e.target.value)}
          />
        </ConfigItem>
        <ConfigItem label={t('form.decimal')}>
          <Input
            value={decimal ?? ''}
            className="h-7 text-[13px]"
            type="number"
            onBlur={() => {
              const newValue = decimal ? Math.max(0, Math.min(decimal, 10)) : undefined;
              onChange({
                ...value,
                decimal: newValue,
              });
              setDecimal(newValue);
            }}
            onChange={(e) => {
              const number = parseInt(e.target.value);
              setDecimal(isNaN(number) ? undefined : number);
            }}
          />
        </ConfigItem>
      </PopoverContent>
    </Popover>
  );
};
