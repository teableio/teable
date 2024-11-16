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
  cn,
} from '@teable/ui-lib';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from '../../../../../context/app/i18n';
import type { IOption, IBaseMultipleSelect } from './types';

function BaseMultipleSelect<V extends string, O extends IOption<V> = IOption<V>>(
  props: IBaseMultipleSelect<V, O>
) {
  const { t } = useTranslation();
  const {
    onSelect,
    value,
    options,
    className,
    popoverClassName,
    placeholderClassName,
    disabled = false,
    optionRender,
    notFoundText = t('common.noRecords'),
    displayRender,
  } = props;
  const [open, setOpen] = useState(false);
  const values = useMemo<V[]>(() => {
    if (Array.isArray(value) && value.length) {
      return value;
    }
    return [];
  }, [value]);

  const selectHandler = (name: V) => {
    let newCellValue: null | V[] = null;
    const existIndex = values.findIndex((item) => item === name);
    if (existIndex > -1) {
      newCellValue = values.slice();
      newCellValue.splice(existIndex, 1);
    } else {
      newCellValue = [...values, name];
    }
    onSelect?.(newCellValue);
  };

  const selectedValues = useMemo<O[]>(() => {
    return options.filter((option) => values.includes(option.value));
  }, [values, options]);

  const optionMap = useMemo(() => {
    const map: Record<string, string> = {};
    options.forEach((option) => {
      const key = option.value;
      const value = option.label;
      map[key] = value;
    });
    return map;
  }, [options]);

  const commandFilter = useCallback(
    (id: string, searchValue: string) => {
      const name = optionMap[id?.trim()]?.toLowerCase()?.trim();
      const containWord = name.indexOf(searchValue?.toLowerCase()) > -1;
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
          className={cn('justify-between overflow-hidden px-2', className)}
        >
          <div className="flex shrink gap-1 overflow-auto whitespace-nowrap">
            {selectedValues?.length ? (
              selectedValues?.map(
                (value, index) =>
                  displayRender?.(value) || (
                    <div key={index} className={cn('px-2 rounded-lg')}>
                      {value.label}
                    </div>
                  )
              )
            ) : (
              <span
                className={cn('text-xs font-normal text-muted-foreground', placeholderClassName)}
              >
                {t('common.selectPlaceHolder')}
              </span>
            )}
          </div>
          <ChevronsUpDown className="ml-2 size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-1', popoverClassName)}>
        <Command className="rounded-sm" filter={commandFilter}>
          <CommandList className="mt-1">
            <CommandInput
              placeholder={t('common.search.placeholder')}
              className="placeholder:text-[13px]"
            />
            <CommandEmpty>{notFoundText}</CommandEmpty>
            <CommandGroup aria-valuetext="name">
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => selectHandler(option.value)}
                  className="truncate p-1 text-[13px]"
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4 shrink-0',
                      values?.includes(option.value) ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {optionRender?.(option) ?? option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

BaseMultipleSelect.displayName = 'BaseMultipleSelect';

export { BaseMultipleSelect };
