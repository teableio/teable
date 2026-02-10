import { DatePicker } from '@/components/ui/date-picker';
import type { FieldInputProps } from './types';

export function DateFieldInput({ field, value, onChange, disabled }: FieldInputProps) {
  const fieldName = field.name().toString();
  const isRequired = field.notNull().toBoolean();

  // Parse the ISO string value to Date
  const dateValue = typeof value === 'string' ? new Date(value) : null;

  const handleChange = (date: Date | null) => {
    // Convert to ISO string for storage
    onChange(date ? date.toISOString() : null);
  };

  return (
    <DatePicker
      value={dateValue}
      onChange={handleChange}
      disabled={disabled}
      placeholder={`Pick ${fieldName.toLowerCase()}${isRequired ? '' : ' (optional)'}`}
    />
  );
}
