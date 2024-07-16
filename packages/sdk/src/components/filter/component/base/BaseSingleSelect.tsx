import {
  Button,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
  CommandList,
  cn,
} from '@teable/ui-lib';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
import type { IOption, IBaseSelect } from './types';

function BaseSingleSelect<V extends string, O extends IOption<V> = IOption<V>>(
  props: IBaseSelect<V, O>
) {
  const { t } = useTranslation();
  const {
    onSelect,
    value,
    options,
    className,
    popoverClassName,
    disabled = false,
    optionRender,
    notFoundText = t('common.noRecords'),
    displayRender,
    search = true,
    placeholder = t('common.search.placeholder'),
    cancelable = false,
  } = props;
  const [open, setOpen] = useState(false);

  const label = useMemo(() => {
    return options.find((option) => option.value === value)?.label || t('common.untitled');
  }, [options, t, value]);

  const selectedValue = useMemo(() => {
    return options.find((option) => option.value === value);
  }, [options, value]);

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
      const name = optionMap[id]?.toLowerCase() || t('common.untitled');
      const containWord = name.indexOf(searchValue?.toLowerCase()) > -1;
      return Number(containWord);
    },
    [optionMap, t]
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          size="sm"
          className={cn('justify-between m-1 truncate overflow-hidden', className)}
        >
          {value
            ? (selectedValue && displayRender?.(selectedValue)) ?? (
                <span className="truncate">{label}</span>
              )
            : t('common.selectPlaceHolder')}
          <ChevronsUpDown className="ml-2 size-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-1', popoverClassName)}>
        <Command filter={commandFilter}>
          {search ? (
            <CommandInput placeholder={placeholder} className="placeholder:text-[13px]" />
          ) : null}
          <CommandEmpty>{notFoundText}</CommandEmpty>
          <CommandList>
            {options?.map((option) => (
              <CommandItem
                key={option.value}
                value={option.value}
                onSelect={() => {
                  // set cancelable support select same value will be reset to null
                  if (cancelable && value === option.value) {
                    onSelect(null);
                    setOpen(false);
                    return;
                  }
                  onSelect(option.value);
                  setOpen(false);
                }}
                className="truncate text-[13px]"
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4 shrink-0',
                    value === option.value ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {optionRender?.(option) ?? option.label ?? t('common.untitled')}
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

BaseSingleSelect.displayName = 'BaseSingleSelect';

export { BaseSingleSelect };
