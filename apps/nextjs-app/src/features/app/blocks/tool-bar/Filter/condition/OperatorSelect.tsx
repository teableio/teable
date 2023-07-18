import type { IFilterMetaOperator } from '@teable-group/core';
import { getValidFilterOperators } from '@teable-group/core';

import { useField } from '@teable-group/sdk';
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
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

interface IOperator {
  value: IFilterMetaOperator;
  label: string;
}

const commonOperator: IOperator[] = [
  {
    value: 'isNotEmpty',
    label: 'isNotEmpty',
  },
  {
    value: 'isEmpty',
    label: 'isEmpty',
  },
];

const defaultOperator: IOperator[] = [
  {
    value: 'contains',
    label: 'contains',
  },
  {
    value: 'doesNotContain',
    label: 'does not contain',
  },
  {
    value: 'is',
    label: 'is',
  },
  {
    value: 'isNot',
    label: 'is not',
  },
  ...commonOperator,
];

interface IOperatorSelectProps {
  value?: string;
  fieldId: string;
  onSelect: (val: IFilterMetaOperator) => void;
}

function OperatorSelect(props: IOperatorSelectProps) {
  const { onSelect, fieldId } = props;
  const [open, setOpen] = useState(false);
  const field = useField(fieldId);
  const operators = useMemo<IOperator[]>(() => {
    if (field) {
      return getValidFilterOperators(field).map((operator) => ({
        label: operator,
        value: operator,
      })) as IOperator[];
    }
    return defaultOperator;
  }, [field]);
  const value = useMemo(() => {
    const index = operators.findIndex((operator) => operator.value === props.value);
    if (index > -1) {
      return props.value;
    } else {
      return operators[0].value;
    }
  }, [operators, props.value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[128px] max-w-[128px] min-w-[128px] justify-between m-1"
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
