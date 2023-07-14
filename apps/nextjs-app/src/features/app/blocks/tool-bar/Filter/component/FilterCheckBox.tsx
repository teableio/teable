import { Checkbox } from '@teable-group/ui-lib/shadcn/ui/checkbox';

interface IFilterCheckboxProps {
  value: boolean;
  onChange: (checked: boolean | null) => void;
}

const FilterCheckbox = (props: IFilterCheckboxProps) => {
  const { value, onChange } = props;
  return (
    <div className="flex items-center space-x-2 w-20 justify-center shadow-sm h-9 rounded mr-2 ml-1 border">
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
