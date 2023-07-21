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
import { useState, useMemo, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

interface IOption {
  label: string;
  value: string;
}

export interface IBaseSelect<T = IOption> {
  options: T[];
  value: string | null;
  className?: string;
  popoverClassName?: string;
  disabled?: boolean;
  notFoundText?: string;
  optionRender?: (option: T) => React.ReactElement;
  onSelect: (value: string | null) => void;
  displayRender?: (option: T) => React.ReactElement;
}

function BaseSingleSelect<T extends IOption>(props: IBaseSelect<T>) {
  const {
    onSelect,
    value,
    options,
    className,
    popoverClassName,
    disabled = false,
    optionRender,
    notFoundText = 'No field found.',
    displayRender,
  } = props;
  const [open, setOpen] = useState(false);

  const label = useMemo(() => {
    return options.find((option) => option.value === value)?.label || 'Untitled';
  }, [options, value]);

  useEffect(() => {
    // other type value comes, adapter or reset
    const isNull = value === null;
    const isSameType = typeof value === 'string';
    const isInOption = options.findIndex((option) => option.value === value) > -1;
    if ((!isNull && !isSameType) || !isInOption) {
      onSelect?.(null);
    }
  }, [onSelect, value, options]);

  const selectedValue = useMemo(() => {
    return options.find((option) => option.value === value);
  }, [options, value]);

  const optionMap = useMemo(() => {
    return new Map(
      options.map((option) => [
        // todo: shadcn bug, id will be toLowerCase in Commond components
        option.value.toLowerCase(),
        option.label.toLowerCase(),
      ])
    );
  }, [options]);

  const commandFilter = useCallback(
    (id: string, searchValue: string) => {
      const name = optionMap.get(id) || 'untitled';
      const containWord = name.indexOf(searchValue) > -1;
      return Number(containWord);
    },
    [optionMap]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('justify-between m-1 truncate overflow-hidden', className)}
        >
          {value
            ? (selectedValue && displayRender?.(selectedValue)) ?? (
                <span className="truncate">{label}</span>
              )
            : 'Select'}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-2', popoverClassName)}>
        <Command filter={commandFilter}>
          <CommandInput placeholder="Search field..." />
          <CommandEmpty>{notFoundText}</CommandEmpty>
          <CommandGroup>
            {options?.map((option) => (
              <CommandItem
                key={option.value}
                value={option.value}
                onSelect={() => {
                  onSelect(option.value);
                  setOpen(false);
                }}
                className="truncate"
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4 shrink-0',
                    value === option.value ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {optionRender?.(option) ?? option.label ?? 'Untitled'}
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
