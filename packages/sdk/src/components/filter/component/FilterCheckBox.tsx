import { Checkbox } from '@teable-group/ui-lib';
import { useEffect } from 'react';

interface IFilterCheckboxProps {
  value: boolean;
  onChange: (checked: boolean | null) => void;
}

const FilterCheckbox = (props: IFilterCheckboxProps) => {
  const { value, onChange } = props;

  useEffect(() => {
    if (typeof value !== 'boolean') {
      onChange(null);
    }
  }, [onChange, value]);

  return (
    <div className="ml-1 mr-2 flex h-8 w-20 items-center justify-center space-x-2 rounded border shadow-sm">
      <Checkbox
        checked={value}
        onCheckedChange={(checked: boolean) => {
          onChange?.(checked || null);
        }}
      />
    </div>
  );
};

export { FilterCheckbox };
