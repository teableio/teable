import type { SingleSelectField } from '@teable-group/sdk';
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
import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

interface ISingleSelect {
  onSelect: (id: string) => void;
  value: unknown;
  fieldId?: string;
}

function SingleSelect(props: ISingleSelect) {
  const { onSelect, fieldId, value } = props;
  const fields = useFields({ widthHidden: true });
  const [open, setOpen] = useState(false);

  const options = useMemo(() => {
    const curColumn = fields.find((item) => item.id === fieldId) as SingleSelectField;
    return curColumn?.options?.choices;
  }, [fieldId, fields]);

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
      <PopoverContent className="w-[200px]">
        <Command>
          <CommandInput placeholder="Search field..." />
          <CommandEmpty>No field found.</CommandEmpty>
          <CommandGroup>
            {options?.map((option) => (
              <CommandItem
                key={option.color}
                onSelect={() => {
                  onSelect(option.name);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4',
                    value === option.name ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {option.name}
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
