import type { Table } from '@teable-group/sdk/model';
import ArrowDownIcon from '@teable-group/ui-lib/icons/app/arrow-down.svg';
import SelectIcon from '@teable-group/ui-lib/icons/app/select.svg';
import classNames from 'classnames';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export const SelectTable = (props: {
  value?: string;
  tables?: Table[];
  onChange?: (id: string) => void;
}) => {
  const { value = '', onChange, tables = [] } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {value ? tables.find(({ id }) => id === value)?.name : 'Select table...'}
          <ArrowDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" style={{ width: ref.current?.offsetWidth }}>
        <Command>
          <CommandInput placeholder="Search table..." />
          <CommandEmpty>No found.</CommandEmpty>
          <CommandGroup>
            {tables.map(({ id, name }) => (
              <CommandItem
                key={id}
                value={id}
                onSelect={() => {
                  onChange?.(id);
                  setOpen(false);
                }}
              >
                <SelectIcon
                  className={classNames('mr-2 h-4 w-4', value === id ? 'opacity-100' : 'opacity-0')}
                />
                {name}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
