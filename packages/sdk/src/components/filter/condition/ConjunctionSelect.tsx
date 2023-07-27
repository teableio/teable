import type { IFilter } from '@teable-group/core';

import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable-group/ui-lib';

import classNames from 'classnames';
import { Check, ChevronsUpDown } from 'lucide-react';
import * as React from 'react';

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
          size="sm"
          aria-expanded={open}
          className="justify-between p-1"
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
      <PopoverContent className="w-fit p-1">
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
                  className={classNames(
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
