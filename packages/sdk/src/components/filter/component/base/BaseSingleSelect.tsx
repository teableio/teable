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
} from '@teable/ui-lib';
import classNames from 'classnames';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useState, useMemo, useEffect } from 'react';
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
    notFoundText = t('common.search.empty'),
    displayRender,
    search = true,
    placeholder = t('common.search.placeholder'),
  } = props;
  const [open, setOpen] = useState(false);

  const label = useMemo(() => {
    return options.find((option) => option.value === value)?.label || t('common.untitled');
  }, [options, t, value]);

  useEffect(() => {
    // other type value comes, adapter or reset
    const isNull = value === null;
    const isSameType = typeof value === 'string';
    const isInOption = options.findIndex((option) => option.value === value) > -1;
    if ((!isNull && !isSameType) || (!isInOption && options.length && !isNull)) {
      onSelect?.(null);
    }
  }, [onSelect, value, options]);

  const selectedValue = useMemo(() => {
    return options.find((option) => option.value === value);
  }, [options, value]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          size="sm"
          className={classNames('justify-between m-1 truncate overflow-hidden', className)}
        >
          {value
            ? (selectedValue && displayRender?.(selectedValue)) ?? (
                <span className="truncate">{label}</span>
              )
            : 'Select'}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={classNames('p-1', popoverClassName)}>
        <Command>
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
                  onSelect(option.value);
                  setOpen(false);
                }}
                className="truncate text-[13px]"
              >
                <Check
                  className={classNames(
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
