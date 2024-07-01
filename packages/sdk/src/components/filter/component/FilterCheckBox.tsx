import { Checkbox, cn } from '@teable/ui-lib';
import { useEffect } from 'react';

interface IFilterCheckboxProps {
  value: boolean;
  onChange: (checked: boolean | null) => void;
  className?: string;
}

const FilterCheckbox = (props: IFilterCheckboxProps) => {
  const { value, onChange, className } = props;

  useEffect(() => {
    if (typeof value !== 'boolean') {
      onChange(null);
    }
  }, [onChange, value]);

  return (
    <div
      className={cn(
        'ml-1 mr-2 flex h-8 items-center justify-center space-x-2 rounded border shadow-sm',
        className
      )}
    >
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
