import { ChartType } from '@teable/openapi';
import {
  cn,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useMemo } from 'react';
import { useChartIcon } from '../../chart/hooks/useChartIcon';
import { FormLabel } from './FormLabel';

interface IChartTypeSelectProps {
  value: string;
  onChange: (type: string) => void;
}

export const ChartTypeSelect = (props: IChartTypeSelectProps) => {
  const { onChange, value } = props;
  const { t } = useTranslation('chart');
  const { iconGetter, labelGetter } = useChartIcon();

  const chartGroup = useMemo(
    () => [
      {
        groupLabel: t('chartV2.form.chartType.bar'),
        items: [
          {
            label: t('chartV2.form.chartType.bar'),
            value: ChartType.Bar,
            icon: iconGetter(ChartType.Bar),
          },
        ],
      },
      {
        groupLabel: t('chartV2.form.chartType.line'),
        items: [
          {
            label: t('chartV2.form.chartType.line'),
            value: ChartType.Line,
            icon: iconGetter(ChartType.Line),
          },
          {
            label: t('chartV2.form.chartType.area'),
            value: ChartType.Area,
            icon: iconGetter(ChartType.Area),
          },
        ],
      },
      {
        groupLabel: t('chartV2.form.chartType.pie'),
        items: [
          {
            label: t('chartV2.form.chartType.pie'),
            value: ChartType.Pie,
            icon: iconGetter(ChartType.Pie),
          },
          {
            label: t('chartV2.form.chartType.donutChart'),
            value: ChartType.DonutChart,
            icon: iconGetter(ChartType.DonutChart),
          },
        ],
      },
    ],
    [iconGetter, t]
  );

  const selectedIcon = useMemo(() => {
    if (!value) return null;
    const Icon = iconGetter(value as ChartType);
    return <Icon className="size-6" />;
  }, [iconGetter, value]);

  return (
    <div className="flex flex-col gap-2 px-0.5">
      <FormLabel label={t('chartV2.form.chartType.title')} labelClassName="text-base font-normal">
        <Select
          defaultValue={value || ''}
          onValueChange={(value: string) => {
            onChange(value);
          }}
        >
          <SelectTrigger className="h-9 w-full">
            {value ? (
              <div className="flex items-center gap-2">
                {selectedIcon}
                <span>{labelGetter(value as ChartType)}</span>
              </div>
            ) : (
              <SelectValue placeholder="Select a fruit" />
            )}
          </SelectTrigger>

          <SelectContent className="w-full p-2">
            {chartGroup.map((group) => (
              <SelectGroup key={group.groupLabel}>
                <SelectLabel className="px-0">{group.groupLabel}</SelectLabel>
                <div className="flex gap-2">
                  {group.items.map((item) => (
                    <SelectItem
                      key={item.value}
                      value={item.value}
                      className={cn(
                        'flex size-16 cursor-pointer items-center justify-center rounded-md border p-3 [&>span:first-child]:hidden',
                        value === item.value && 'border-primary'
                      )}
                    >
                      <item.icon className="size-10" />
                    </SelectItem>
                  ))}
                </div>
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </FormLabel>
    </div>
  );
};
