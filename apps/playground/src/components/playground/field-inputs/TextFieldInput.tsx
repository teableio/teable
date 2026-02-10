import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { FieldInputProps } from './types';

export function TextFieldInput({ field, value, onChange, onBlur, disabled }: FieldInputProps) {
  const fieldType = field.type().toString();
  const fieldName = field.name().toString();
  const isRequired = field.notNull().toBoolean();
  const isLongText = fieldType === 'longText';

  if (isLongText) {
    return (
      <Textarea
        id={field.id().toString()}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value || null)}
        onBlur={onBlur}
        disabled={disabled}
        placeholder={`Enter ${fieldName.toLowerCase()}${isRequired ? '' : ' (optional)'}`}
        rows={3}
      />
    );
  }

  return (
    <Input
      id={field.id().toString()}
      type="text"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onChange(e.target.value || null)}
      onBlur={onBlur}
      disabled={disabled}
      placeholder={`Enter ${fieldName.toLowerCase()}${isRequired ? '' : ' (optional)'}`}
    />
  );
}
