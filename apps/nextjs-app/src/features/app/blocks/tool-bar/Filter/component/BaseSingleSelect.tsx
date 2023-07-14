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

interface IOption {
  label: string;
  value: string;
}

interface IBaseSelect {
  options: IOption[];
  value: string | null;
  classNames?: string;
  popoverClassNames?: string;
  onSelect: (value: string) => void;
}

function BaseSingleSelect(props: IBaseSelect) {
  const { onSelect, value, options, classNames, popoverClassNames } = props;
  const [open, setOpen] = useState(false);

  const label = useMemo(() => {
    return options.find((option) => option.value === value)?.label;
  }, [options, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('justify-between m-1', classNames)}
        >
          {value ? <span className="truncate">{label}</span> : 'Select'}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('w-52', popoverClassNames)}>
        <Command>
          <CommandInput placeholder="Search field..." />
          <CommandEmpty>No field found.</CommandEmpty>
          <CommandGroup>
            {options?.map((option) => (
              <CommandItem
                key={option.label}
                onSelect={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    value === option.value ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {option.label}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

BaseSingleSelect.displayName = 'BaseSingleSelect';

export { BaseSingleSelect };
