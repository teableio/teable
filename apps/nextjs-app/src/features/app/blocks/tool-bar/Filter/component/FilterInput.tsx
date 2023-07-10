import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

const FilterInput = (props: InputProps) => {
  const { onChange, placeholder = 'Enter a value', value } = props;

  return (
    <Input
      placeholder={placeholder}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
      }}
      className="m-1 bg-white"
    />
  );
};

FilterInput.displayName = 'FilterInput';

export { FilterInput };
