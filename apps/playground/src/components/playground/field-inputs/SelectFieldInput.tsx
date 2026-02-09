import { Check, X } from 'lucide-react';
import { type SingleSelectField, type MultipleSelectField } from '@teable/v2-core';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import type { FieldInputProps } from './types';

interface SelectOption {
  id: string;
  name: string;
  color: string;
}

function getSelectOptions(field: SingleSelectField | MultipleSelectField): SelectOption[] {
  return field.selectOptions().map((opt) => ({
    id: opt.id().toString(),
    name: opt.name().toString(),
    color: opt.color().toString(),
  }));
}

function SingleSelectInput({
  field,
  value,
  onChange,
  disabled,
}: FieldInputProps & { field: SingleSelectField }) {
  const options = getSelectOptions(field);
  const fieldName = field.name().toString();
  const isRequired = field.notNull().toBoolean();

  if (options.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-2 border rounded-md">
        No options configured for this field
      </div>
    );
  }

  return (
    <Select
      value={typeof value === 'string' ? value : ''}
      onValueChange={(val) => onChange(val || null)}
      disabled={disabled}
    >
      <SelectTrigger className="w-full">
        <SelectValue
          placeholder={`Select ${fieldName.toLowerCase()}${isRequired ? '' : ' (optional)'}`}
        />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: getColorHex(option.color) }}
              />
              {option.name}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MultipleSelectInput({
  field,
  value,
  onChange,
  disabled,
}: FieldInputProps & { field: MultipleSelectField }) {
  const [open, setOpen] = useState(false);
  const options = getSelectOptions(field);
  const fieldName = field.name().toString();

  const selectedValues: string[] = Array.isArray(value) ? value : [];

  if (options.length === 0) {
    return (
      <div className="text-sm text-muted-foreground p-2 border rounded-md">
        No options configured for this field
      </div>
    );
  }

  const handleSelect = (optionId: string) => {
    const newValues = selectedValues.includes(optionId)
      ? selectedValues.filter((v) => v !== optionId)
      : [...selectedValues, optionId];
    onChange(newValues.length > 0 ? newValues : null);
  };

  const handleRemove = (optionId: string) => {
    const newValues = selectedValues.filter((v) => v !== optionId);
    onChange(newValues.length > 0 ? newValues : null);
  };

  const getOptionById = (id: string) => options.find((opt) => opt.id === id);

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className="w-full justify-between font-normal"
          >
            {selectedValues.length > 0
              ? `${selectedValues.length} selected`
              : `Select ${fieldName.toLowerCase()}`}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-full p-0" align="start">
          <Command>
            <CommandInput placeholder="Search options..." />
            <CommandList>
              <CommandEmpty>No options found.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    onSelect={() => handleSelect(option.id)}
                    className="cursor-pointer"
                  >
                    <div className="flex items-center gap-2 flex-1">
                      <div
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: getColorHex(option.color) }}
                      />
                      {option.name}
                    </div>
                    <Check
                      className={cn(
                        'h-4 w-4',
                        selectedValues.includes(option.id) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedValues.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedValues.map((id) => {
            const option = getOptionById(id);
            if (!option) return null;
            return (
              <Badge
                key={id}
                variant="secondary"
                className="gap-1 pr-1"
                style={{
                  backgroundColor: getColorHex(option.color) + '20',
                  borderColor: getColorHex(option.color),
                }}
              >
                {option.name}
                <button
                  type="button"
                  onClick={() => handleRemove(id)}
                  className="ml-1 hover:bg-muted rounded-full p-0.5"
                  disabled={disabled}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Map field color names to hex values
function getColorHex(color: string): string {
  const colorMap: Record<string, string> = {
    blue: '#3b82f6',
    red: '#ef4444',
    green: '#22c55e',
    yellow: '#eab308',
    orange: '#f97316',
    purple: '#a855f7',
    pink: '#ec4899',
    teal: '#14b8a6',
    cyan: '#06b6d4',
    gray: '#6b7280',
  };
  return colorMap[color] || '#6b7280';
}

export function SelectFieldInput(props: FieldInputProps) {
  const fieldType = props.field.type().toString();

  if (fieldType === 'singleSelect') {
    return <SingleSelectInput {...props} field={props.field as SingleSelectField} />;
  }

  if (fieldType === 'multipleSelect') {
    return <MultipleSelectInput {...props} field={props.field as MultipleSelectField} />;
  }

  return null;
}
