import { Input } from '@/components/ui/input';
import type { FieldInputProps } from './types';

export function NumberFieldInput({ field, value, onChange, onBlur, disabled }: FieldInputProps) {
  const fieldName = field.name().toString();
  const isRequired = field.notNull().toBoolean();

  return (
    <Input
      id={field.id().toString()}
      type="number"
      value={typeof value === 'number' ? value : ''}
      onChange={(e) => {
        const val = e.target.value;
        onChange(val === '' ? null : Number(val));
      }}
      onBlur={onBlur}
      disabled={disabled}
      placeholder={`Enter ${fieldName.toLowerCase()}${isRequired ? '' : ' (optional)'}`}
    />
  );
}
