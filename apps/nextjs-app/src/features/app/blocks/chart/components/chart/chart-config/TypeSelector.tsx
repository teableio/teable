/* eslint-disable jsx-a11y/click-events-have-key-events */
/* eslint-disable jsx-a11y/no-static-element-interactions */
import { ChevronsUpDown, Table2 } from '@teable/icons';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib';
import { BarChart, LineChart, PieChart, AreaChart } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useMemo, useState } from 'react';
import type { IChartConfig } from '../../../types';

export const TypeSelector = (props: {
  className?: string;
  type?: IChartConfig['type'];
  onChange: (type: IChartConfig['type']) => void;
}) => {
  const { className, type, onChange } = props;
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('chart');

  const options = useMemo(() => {
    return [
      {
        label: t('chart.bar'),
        value: 'bar',
        Icon: BarChart,
      },
      {
        label: t('chart.line'),
        value: 'line',
        Icon: LineChart,
      },
      {
        label: t('chart.pie'),
        value: 'pie',
        Icon: PieChart,
      },
      {
        label: t('chart.area'),
        value: 'area',
        Icon: AreaChart,
      },
      {
        label: t('chart.table'),
        value: 'table',
        Icon: Table2,
      },
    ] as const;
  }, [t]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('w-full justify-between h-8 font-normal', className)}
        >
          {options.find((o) => o.value === type)?.label ?? (
            <span className="text-muted-foreground">{t('form.chartType.placeholder')}</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent>
        <div className="flex flex-wrap gap-4">
          {options.map(({ label, Icon, value }) => (
            <div
              key={value}
              onClick={() => {
                onChange(value);
                setOpen(false);
              }}
            >
              <div
                className={cn('hover:border-primary cursor-pointer rounded-full border p-3', {
                  'border-primary': type === value,
                })}
              >
                <Icon />
              </div>
              <div className="text-center text-sm">{label}</div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};
