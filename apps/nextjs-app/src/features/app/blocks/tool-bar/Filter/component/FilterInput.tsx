import { Input } from '@teable-group/ui-lib/shadcn/ui/input';
interface InputProps {
  value: string;
  onChange: (value: string | null) => void;
  placeholder: string;
}

const FilterInput = (props: InputProps) => {
  const { onChange, placeholder = 'Enter a value', value } = props;

  return (
    <Input
      placeholder={placeholder}
      value={value || ''}
      onChange={(e) => {
        onChange(e.target.value || null);
      }}
      className="m-1"
    />
  );
};

FilterInput.displayName = 'FilterInput';

export { FilterInput };
