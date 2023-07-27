import {
  Button,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable-group/ui-lib';
import classNames from 'classnames';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';
import type { IOption, IBaseSelect } from './types';

interface IBaseMultipleSelect<T> extends Omit<IBaseSelect<T>, 'onSelect' | 'value'> {
  options: T[];
  value: string[] | null;
  onSelect: (value: string[]) => void;
  className?: string;
  popoverClassName?: string;
  disabled?: boolean;
  notFoundText?: string;
  optionRender?: (option: T) => React.ReactElement;
  displayRender?: (option: T) => React.ReactElement;
}

function BaseMultipleSelect<T extends IOption>(props: IBaseMultipleSelect<T>) {
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
  const values = useMemo<string[]>(() => {
    if (Array.isArray(value) && value.length) {
      return value;
    }
    return [];
  }, [value]);

  const selectHandler = (name: string) => {
    let newCellValue = null;
    const existIndex = values.findIndex((item) => item === name);
    if (existIndex > -1) {
      newCellValue = values.slice();
      newCellValue.splice(existIndex, 1);
    } else {
      newCellValue = [...values, name];
    }
    onSelect?.(newCellValue);
  };

  const selectedValues = useMemo<T[]>(() => {
    return options.filter((option) => values.includes(option.value));
  }, [values, options]);

  const optionMap = useMemo(() => {
    const map: Record<string, string> = {};
    options.forEach((option) => {
      const key = option.value.toLowerCase();
      const value = option.label.toLowerCase();
      map[key] = value;
    });
    return map;
  }, [options]);

  const commandFilter = useCallback(
    (id: string, searchValue: string) => {
      const name = optionMap[id] || 'Untitled';
      const containWord = name.indexOf(searchValue.toLowerCase()) > -1;
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
          size="sm"
          aria-expanded={open}
          disabled={disabled}
          className={classNames('w-32 justify-between m-1 overflow-hidden', className)}
        >
          <div className="shrink whitespace-nowrap overflow-hidden flex">
            {selectedValues?.length
              ? selectedValues?.map(
                  (value, index) =>
                    displayRender?.(value) || (
                      <div key={index} className={classNames('px-2 rounded-lg m-1')}>
                        {value.label}
                      </div>
                    )
                )
              : 'Select'}
          </div>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={classNames('p-1', popoverClassName)}>
        <Command className="rounded-sm" filter={commandFilter}>
          <CommandList>
            <CommandInput placeholder="Search option" className="placeholder:text-[13px]" />
            <CommandEmpty>{notFoundText}</CommandEmpty>
            <CommandGroup aria-valuetext="name">
              {options.length ? (
                options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => selectHandler(option.value)}
                    className="truncate p-1 text-[13px]"
                  >
                    <Check
                      className={classNames(
                        'mr-2 h-4 w-4 shrink-0',
                        values?.includes(option.value) ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    {optionRender?.(option) ?? option.label}
                  </CommandItem>
                ))
              ) : (
                <span className="text-[13px] text-gray-600">no result</span>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

BaseMultipleSelect.displayName = 'BaseMultipleSelect';

export { BaseMultipleSelect };
