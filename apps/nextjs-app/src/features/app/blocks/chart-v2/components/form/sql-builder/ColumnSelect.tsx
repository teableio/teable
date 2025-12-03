import { BaseSingleSelect } from '@teable/sdk/components/filter/view-filter/component';
import { useMemo } from 'react';
interface IColumnSelectProps {
  value: string | null;
  options: {
    value: string;
    label: string;
  }[];
  onSelect: (value: string) => void;
  filterSelected?: boolean;
  className?: string;
}
export const ColumnSelect = (props: IColumnSelectProps) => {
  const { value, options, onSelect, filterSelected = false, className } = props;
  const finalOptions = useMemo(() => {
    if (filterSelected && value) {
      return options.filter((option) => option.value !== value);
    }
    return options;
  }, [filterSelected, value, options]);
  return (
    <BaseSingleSelect
      options={finalOptions}
      onSelect={(value) => {
        onSelect(value as string);
      }}
      className={className}
      value={value || null}
    />
  );
};
