import { BaseSingleSelect } from '@teable/sdk/components/filter/view-filter/component';
import { useMemo } from 'react';
import { RollupFunc } from './types';

interface IStatisticFunSelectProps {
  value: RollupFunc;
  onChange: (value: RollupFunc) => void;
  className?: string;
}

export const StatisticFunSelect = (props: IStatisticFunSelectProps) => {
  const { value, onChange, className } = props;
  const options = useMemo(() => {
    return Object.values(RollupFunc).map((func) => ({
      value: func,
      label: func,
    }));
  }, []);
  return (
    <BaseSingleSelect
      options={options}
      value={value}
      onSelect={(value) => {
        onChange(value as RollupFunc);
      }}
      className={className}
    />
  );
};
