import { FieldType } from '@teable-group/core';
import type { IAllFieldOperators } from '@teable-group/core';
import { useFields } from '@teable-group/sdk';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@teable-group/ui-lib/shadcn/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

interface IOperator {
  value: IAllFieldOperators[number];
  label: IAllFieldOperators[number];
}

const defaultOperator: IOperator[] = [
  {
    value: 'contains',
    label: 'contains',
  },
  {
    value: 'is',
    label: 'is',
  },
  {
    value: 'isNotEmpty',
    label: 'isNotEmpty',
  },
  {
    value: 'isEmpty',
    label: 'isEmpty',
  },
];

const FieldOperatorTypeMap = {
  [FieldType.SingleLineText]: [...defaultOperator],
  [FieldType.Attachment]: [...defaultOperator],
  [FieldType.MultipleSelect]: [...defaultOperator],
  [FieldType.SingleSelect]: [...defaultOperator],
  [FieldType.Date]: [
    {
      value: 'isRepeat',
      label: 'isRepeat',
    },
    ...defaultOperator,
  ],
  [FieldType.Number]: [...defaultOperator],
  [FieldType.Formula]: [...defaultOperator],
  [FieldType.Link]: [...defaultOperator],
};

interface IOperatorSelectProps {
  value?: string;
  fieldId: string;
  onSelect: (val: IAllFieldOperators[number]) => void;
}

function OperatorSelect(props: IOperatorSelectProps) {
  const { onSelect, fieldId } = props;
  const [open, setOpen] = useState(false);
  const fields = useFields();
  const operators = useMemo<IOperator[]>(() => {
    const fieldType = fields.find((field) => field.id === fieldId)?.type;
    if (fieldType) {
      return FieldOperatorTypeMap[fieldType] as IOperator[];
    }
    return defaultOperator;
  }, [fieldId, fields]);
  const initValue = useMemo(() => {
    const index = operators.findIndex((operator) => operator.value === props.value);
    if (index > -1) {
      return props.value;
    } else {
      return operators[0].value;
    }
  }, [operators, props.value]);
  const [value, setValue] = useState(initValue || props.value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[128px] max-w-[128px] min-w-[128px] justify-between m-1 bg-white"
        >
          {value ? (
            <span className="truncate">
              {operators.find((operator) => operator.value === value)?.label}
            </span>
          ) : (
            'Select'
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px]">
        <Command>
          <CommandInput placeholder="Search operators..." />
          <CommandEmpty>No operators found.</CommandEmpty>
          <CommandGroup>
            {operators.map((operator) => (
              <CommandItem
                key={operator.value}
                onSelect={() => {
                  setValue(operator.value);
                  onSelect(operator.value);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    value === operator.value ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {operator.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

OperatorSelect.displayName = 'OperatorSelect';

export { OperatorSelect };
