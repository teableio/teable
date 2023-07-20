import { ColorUtils } from '@teable-group/core';
import type { SingleSelectField } from '@teable-group/sdk';

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
import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

interface ISingleSelect {
  onSelect: (id: string | null) => void;
  operator: string;
  value: string | null;
  field: SingleSelectField;
}

function SingleSelect(props: ISingleSelect) {
  const { onSelect, field, value, operator } = props;
  const [open, setOpen] = useState(false);

  const options = useMemo(() => {
    return field?.options?.choices;
  }, [field]);

  useEffect(() => {
    // other type value comes, adapter or reset
    const isNull = value === null;
    const isSameType = typeof value === 'string';
    const isInOption = options.findIndex((option) => option.name === value) > -1;
    if ((!isNull && !isSameType) || !isInOption) {
      onSelect?.(null);
    }
  }, [onSelect, value, operator, options]);

  const label = useMemo(() => {
    return options.find((option) => option.name === value)?.name;
  }, [options, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-[128px] max-w-[128px] min-w-[128px] justify-between m-1"
        >
          {value ? <span className="truncate">{label}</span> : 'Select'}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-52 max-w-xs">
        <Command>
          <CommandInput placeholder="Search field..." />
          <CommandEmpty>No field found.</CommandEmpty>
          <CommandGroup>
            {options?.map(({ color, name }) => (
              <CommandItem
                key={color}
                onSelect={() => {
                  onSelect(name);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4 shrink-0',
                    value === name ? 'opacity-100' : 'opacity-0'
                  )}
                />
                <div
                  className="px-2 rounded-lg truncate"
                  style={{
                    backgroundColor: ColorUtils.getHexForColor(color),
                    color: ColorUtils.shouldUseLightTextOnColor(color) ? '#ffffff' : '#000000',
                  }}
                >
                  {name}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

SingleSelect.displayName = 'SingleSelect';

export { SingleSelect };
