import type { IFilter } from '@teable-group/core';
import { Button } from '@teable-group/ui-lib/shadcn/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@teable-group/ui-lib/shadcn/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@teable-group/ui-lib/shadcn/ui/popover';
import { Check, ChevronsUpDown } from 'lucide-react';
import * as React from 'react';
import { cn } from '@/lib/utils';

const ConjunctionOptions = [
  {
    value: 'and',
    label: 'and',
  },
  {
    value: 'or',
    label: 'or',
  },
];

interface IConjunctionSelectProps {
  value: unknown;
  onSelect: (val: IFilter['conjunction']) => void;
}

function ConjunctionSelect(props: IConjunctionSelectProps) {
  const { onSelect } = props;
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(props.value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="justify-between p-1 bg-white"
        >
          {value ? (
            <span className="truncate text-sm">
              {ConjunctionOptions.find((conjunction) => conjunction.value === value)?.label}
            </span>
          ) : (
            <span className="truncate text-sm">and</span>
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px]">
        <Command>
          <CommandEmpty>No conjunction found.</CommandEmpty>
          <CommandGroup>
            {ConjunctionOptions.map((conjunction) => (
              <CommandItem
                key={conjunction.value}
                onSelect={(currentValue: string) => {
                  setValue(currentValue === value ? '' : currentValue);
                  onSelect(currentValue as IFilter['conjunction']);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    value === conjunction.value ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {conjunction.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

ConjunctionSelect.displayName = 'ConjunctionSelect';

export { ConjunctionSelect };
