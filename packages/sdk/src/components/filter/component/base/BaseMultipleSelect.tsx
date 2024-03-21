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
} from '@teable/ui-lib';
import classNames from 'classnames';

import { Check, ChevronsUpDown } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useTranslation } from '../../../../context/app/i18n';
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
    disabled = false,
    optionRender,
    notFoundText = t('common.search.empty'),
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
          <div className="flex shrink overflow-hidden whitespace-nowrap">
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
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={classNames('p-1', popoverClassName)}>
        <Command className="rounded-sm">
          <CommandList>
            <CommandInput
              placeholder={t('common.search.placeholder')}
              className="placeholder:text-[13px]"
            />
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
                <span className="text-[13px] text-gray-600">{t('common.noRecords')}</span>
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
