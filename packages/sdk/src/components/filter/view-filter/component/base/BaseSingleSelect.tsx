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
import { debounce } from 'lodash';
import { Check, ChevronDown } from 'lucide-react';
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useTranslation } from '../../../../../context/app/i18n';
import type { IOption, IBaseSelect } from './types';

function BaseSingleSelect<V extends string, O extends IOption<V> = IOption<V>>(
  props: IBaseSelect<V, O>
) {
  const [searchValue, setSearchValue] = useState('');
  const [isComposing, setIsComposing] = useState(false);

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
    search = true,
    onSearch,
    placeholder = t('common.search.placeholder'),
    cancelable = false,
    defaultLabel = t('common.untitled'),
    modal,
  } = props;
  const [open, setOpen] = useState(false);

  const label = useMemo(() => {
    return options.find((option) => option.value === value)?.label || defaultLabel;
  }, [defaultLabel, options, value]);

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
      const name = optionMap[id?.trim()]?.toLowerCase()?.trim();
      const containWord = name.indexOf(searchValue?.toLowerCase()) > -1;
      return Number(containWord);
    },
    [optionMap]
  );

  const setApplySearchDebounced = useMemo(() => {
    return onSearch ? debounce(onSearch, 200) : undefined;
  }, [onSearch]);

  useEffect(() => {
    if (!isComposing) {
      setApplySearchDebounced?.(searchValue);
    }
  }, [searchValue, isComposing, onSearch, setApplySearchDebounced]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('justify-between truncate overflow-hidden px-3 font-normal', className)}
        >
          {value ? (
            (selectedValue && displayRender?.(selectedValue)) ?? (
              <span className="truncate">{label}</span>
            )
          ) : (
            <span className={cn('text-sm font-normal text-muted-foreground', placeholderClassName)}>
              {t('common.selectPlaceHolder')}
            </span>
          )}
          <ChevronDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-1', popoverClassName)}>
        <Command filter={onSearch ? undefined : commandFilter} shouldFilter={!onSearch}>
          {search ? (
            <CommandInput
              placeholder={placeholder}
              className="placeholder:text-sm"
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={() => setIsComposing(false)}
              onValueChange={(value) => setSearchValue(value)}
            />
          ) : null}
          <CommandEmpty>{notFoundText}</CommandEmpty>
          <CommandList className="mt-1">
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
                className="truncate text-sm"
              >
                <Check
                  className={cn(
                    'mr-2 h-4 w-4 shrink-0',
                    value === option.value ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {optionRender?.(option) ?? option.label ?? defaultLabel}
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
