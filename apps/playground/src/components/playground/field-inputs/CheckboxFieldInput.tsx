import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import type { FieldInputProps } from './types';

export function CheckboxFieldInput({ field, value, onChange, onBlur, disabled }: FieldInputProps) {
  const checked = value === true;

  return (
    <div className="flex items-center space-x-2">
      <Checkbox
        id={field.id().toString()}
        checked={checked}
        onCheckedChange={(checked) => onChange(checked === true)}
        onBlur={onBlur}
        disabled={disabled}
      />
      <Label htmlFor={field.id().toString()} className="text-sm font-normal cursor-pointer">
        {checked ? 'Yes' : 'No'}
      </Label>
    </div>
  );
}
