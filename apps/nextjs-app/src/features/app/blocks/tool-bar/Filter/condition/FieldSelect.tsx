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
import { useCallback, useMemo, useState } from 'react';
import { useFieldStaticGetter } from '@/features/app/utils';
import { cn } from '@/lib/utils';

interface IFieldSelectProps {
  fieldId?: string;
  onSelect: (type: string) => void;
}

function FieldSelect(props: IFieldSelectProps) {
  const { fieldId: value, onSelect } = props;
  const [open, setOpen] = useState(false);

  const fields = useFields({ widthHidden: true });
  const fieldsIdNameMap = useMemo(() => {
    return new Map(
      fields.map((field) => [
        // todo: shadcn bug, id will be toLowerCase in Commond components
        field.id.toLowerCase(),
        field.name,
      ])
    );
  }, [fields]);
  const fieldStaticGetter = useFieldStaticGetter();

  const label = useMemo(() => {
    return fields.find((field) => field.id === value)?.name;
  }, [value, fields]);

  const commandFilter = useCallback(
    (id: string, searchValue: string) => {
      const name = fieldsIdNameMap.get(id);
      if (!name) {
        return 0;
      }
      const containWord = name.indexOf(searchValue) > -1;
      return Number(containWord);
    },
    [fieldsIdNameMap]
  );

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
        <Command filter={commandFilter}>
          <CommandInput placeholder="Search field..." />
          <CommandEmpty>No field found.</CommandEmpty>
          <CommandGroup>
            {fields.map((field) => {
              const { Icon } = fieldStaticGetter(field.type, field.isLookup);
              return (
                <CommandItem
                  key={field.id}
                  value={field.id}
                  onSelect={() => {
                    onSelect(field.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn('mr-2 h-4 w-4', value === field.id ? 'opacity-100' : 'opacity-0')}
                  />
                  <Icon></Icon>
                  <span className="pl-1">{field.name}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

FieldSelect.displayName = 'FieldSelect';

export { FieldSelect };
