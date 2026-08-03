import { Checkbox, cn } from '@teable/ui-lib';

interface IFilterCheckboxProps {
  value: boolean;
  onChange: (checked: boolean | null) => void;
  className?: string;
}

const FilterCheckbox = (props: IFilterCheckboxProps) => {
  const { value, onChange, className } = props;

  return (
    <div
      className={cn(
        'flex h-8 items-center justify-center space-x-2 rounded border shadow-sm border-input',
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
