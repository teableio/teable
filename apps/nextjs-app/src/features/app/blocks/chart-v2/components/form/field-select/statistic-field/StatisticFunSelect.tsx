import { FieldRollup } from '@teable/openapi';
import { BaseSingleSelect } from '@teable/sdk/components/filter/view-filter/component';
import { useMemo } from 'react';

interface IStatisticFunSelectProps {
  value: FieldRollup;
  onChange: (value: FieldRollup) => void;
  className?: string;
}

export const StatisticFunSelect = (props: IStatisticFunSelectProps) => {
  const { value, onChange, className } = props;
  const options = useMemo(() => {
    return Object.values(FieldRollup).map((func) => ({
      value: func,
      label: func,
    }));
  }, []);
  return (
    <BaseSingleSelect
      options={options}
      value={value}
      onSelect={(value) => {
        onChange(value as FieldRollup);
      }}
      className={className}
    />
  );
};
