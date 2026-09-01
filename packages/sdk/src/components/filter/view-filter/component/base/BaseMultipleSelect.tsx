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

import { debounce } from 'lodash';
import { Check, ChevronDown } from 'lucide-react';
import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from '../../../../../context/app/i18n';
import { NestedDrawer, useInDrawer } from '../../../../adaptive-panel';
import type { IOption, IBaseMultipleSelect } from './types';
import { scrollListByWheel } from './wheel-scroll-list';

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
    placeholder = t('common.selectPlaceHolder'),
    disabled = false,
    optionRender,
    notFoundText = t('common.noRecords'),
    displayRender,
    onSearch,
    modal,
    drawerTitle,
  } = props;
  const inDrawer = useInDrawer();
  const [open, setOpen] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const popoverContentRef = useRef<HTMLDivElement>(null);
  const [searchValue, setSearchValue] = useState('');
  const [isComposing, setIsComposing] = useState(false);

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
    onSelect?.(newCellValue ?? []);
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
      const name = optionMap?.[id?.trim()]?.toLowerCase() || '';
      return name.includes(searchValue?.toLowerCase()?.trim()) ? 1 : 0;
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

  useEffect(() => {
    const popoverContent = popoverContentRef.current;
    if (!open || !popoverContent) {
      return;
    }

    const handleWheel = (event: WheelEvent) => scrollListByWheel(event, listRef.current);
    popoverContent.addEventListener('wheel', handleWheel, { passive: false, capture: true });
    return () => popoverContent.removeEventListener('wheel', handleWheel, true);
  }, [open]);

  const trigger = (
    <Button
      variant="outline"
      role="combobox"
      size="sm"
      aria-expanded={open}
      disabled={disabled}
      className={cn(
        'justify-between overflow-hidden px-2',
        // Before `className`, so a caller stating its own drawer width wins.
        inDrawer && 'h-9 w-full min-w-0 shrink',
        className
      )}
    >
      <div className="flex shrink gap-1.5 overflow-hidden whitespace-nowrap">
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
          <span className={cn('text-sm font-normal text-muted-foreground', placeholderClassName)}>
            {placeholder}
          </span>
        )}
      </div>
      <ChevronDown
        className={cn(
          'ms-2 size-4 shrink-0 text-muted-foreground transition-transform duration-200',
          open && 'rotate-180'
        )}
      />
    </Button>
  );

  const commandBody = (
    <Command
      className={cn(
        'rounded-sm',
        inDrawer && 'h-full max-w-none rounded-none bg-transparent shadow-none'
      )}
      filter={onSearch ? undefined : commandFilter}
      shouldFilter={!onSearch}
    >
      <CommandInput
        placeholder={t('common.search.placeholder')}
        className="placeholder:text-[13px]"
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => setIsComposing(false)}
        onValueChange={(value) => setSearchValue(value)}
      />
      <CommandEmpty>{notFoundText}</CommandEmpty>
      <CommandList ref={listRef} className={cn('mt-1', inDrawer && 'max-h-full flex-1 p-2')}>
        <CommandGroup aria-valuetext="name">
          {options.map((option) => (
            <CommandItem
              key={option.value}
              value={option.value}
              onSelect={() => selectHandler(option.value)}
              className={cn(
                'w-full truncate p-1 text-[13px]',
                inDrawer && 'h-9 gap-2 rounded-md px-3 text-sm',
                inDrawer && values?.includes(option.value) && 'bg-accent text-accent-foreground'
              )}
            >
              {!inDrawer && (
                <Check
                  className={cn(
                    'me-2 h-4 w-4 shrink-0',
                    values?.includes(option.value) ? 'opacity-100' : 'opacity-0'
                  )}
                />
              )}
              {/* Drawer only - see the note in BaseSingleSelect. Wrapping on
                  desktop would stretch the content-sized colour chips that
                  FilterMultipleSelect renders. */}
              {inDrawer ? (
                <span className="min-w-0 flex-1 truncate">
                  {optionRender?.(option) ?? option.label}
                </span>
              ) : (
                optionRender?.(option) ?? option.label
              )}
              {inDrawer && values?.includes(option.value) && <Check className="size-4 shrink-0" />}
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  );

  if (inDrawer) {
    return (
      <NestedDrawer
        open={open}
        onOpenChange={setOpen}
        title={drawerTitle ?? t('common.selectPlaceHolder')}
        size="list"
        content={commandBody}
      >
        {trigger}
      </NestedDrawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent ref={popoverContentRef} align="start" className={cn('p-1', popoverClassName)}>
        {commandBody}
      </PopoverContent>
    </Popover>
  );
}

BaseMultipleSelect.displayName = 'BaseMultipleSelect';

export { BaseMultipleSelect };
