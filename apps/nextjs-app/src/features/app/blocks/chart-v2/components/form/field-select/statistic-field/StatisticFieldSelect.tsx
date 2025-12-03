import type { IStatisticFieldItem } from '@teable/openapi';
import { ChartType } from '@teable/openapi';
import { useMemo } from 'react';
import { useStorage } from '../../../../hooks';
import { AddFieldButton } from './AddFieldButton';
import { StatisticFieldItem } from './StatisticFieldItem';

interface IStatisticFieldSelectProps {
  value: IStatisticFieldItem[];
  onChange: (value: IStatisticFieldItem[]) => void;
}

export const StatisticFieldSelect = (props: IStatisticFieldSelectProps) => {
  const { value = [], onChange } = props;
  const handleChange = (index: number, valueItem: IStatisticFieldItem) => {
    const newValue = [...value];
    newValue.splice(index, 1, valueItem);
    onChange(newValue);
  };
  const handleDelete = (index: number) => {
    const newValue = [...value];
    newValue.splice(index, 1);
    onChange(newValue);
  };
  const { storage } = useStorage();
  const { chartType } = storage;

  const displayAddFieldButton = useMemo(() => {
    const isBarChart = [ChartType.Pie, ChartType.DonutChart].includes(chartType as ChartType);
    if (isBarChart && value.length === 1) {
      return false;
    }
    return true;
  }, [chartType, value.length]);

  return (
    <div className="flex flex-col gap-2">
      {value.map((item, index) => (
        <StatisticFieldItem
          key={item.fieldId}
          allStaticFields={value}
          value={item}
          onChange={(value) => handleChange(index, value)}
          onDelete={() => handleDelete(index)}
        />
      ))}

      {displayAddFieldButton && <AddFieldButton />}
    </div>
  );
};
