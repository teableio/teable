import type { CellValueType, FieldType } from '@teable/core';
import { Check, ChevronDown } from '@teable/icons';
import { useFieldStaticGetter } from '@teable/sdk/hooks';
import {
  Button,
  cn,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib';
import { useTranslation } from 'next-i18next';
import { useCallback, useMemo, useState } from 'react';
import { useFields } from '../../../hooks';

interface IFieldSelectProps {
  value: string | undefined;
  selectedFields?: string[];
  className?: string;
  placeholderClassName?: string;
  popoverClassName?: string;
  notFoundText?: React.ReactNode;
  placeholder?: string;
  onChange: (value: string) => void;
  allowCellValueType?: CellValueType[];
  allowType?: FieldType[];
  notAllowedFields?: FieldType[];
}
export const FieldSelect = (props: IFieldSelectProps) => {
  const { t } = useTranslation(['common', 'chart', 'sdk']);
  const fieldStaticGetter = useFieldStaticGetter();

  const {
    value,
    selectedFields,
    className,
    placeholderClassName,
    popoverClassName,
    placeholder = t('sdk:common.search.placeholder'),
    notFoundText = t('sdk:common.noRecords'),
    onChange,
    allowCellValueType,
    allowType,
    notAllowedFields,
  } = props;
  const { fields } = useFields();
  const [open, setOpen] = useState(false);
  const [, setSearch] = useState('');
  const [, setIsComposing] = useState(false);
  const options = useMemo(() => {
    return fields
      ?.filter((f) => {
        if (!allowType) {
          return true;
        }
        return allowType.some((type) => type === f.type);
      })
      ?.filter((f) => {
        if (!notAllowedFields) {
          return true;
        }
        return !notAllowedFields.some((type) => type === f.type);
      })
      ?.filter((f) => {
        if (!allowCellValueType) {
          return true;
        }
        return allowCellValueType.some((value) => value === f.cellValueType);
      })
      ?.filter((f) => {
        if (!selectedFields) {
          return true;
        }
        return !selectedFields.includes(f.id);
      })
      ?.map((f) => ({
        value: f.id,
        label: f.name,
      }));
  }, [allowCellValueType, allowType, fields, notAllowedFields, selectedFields]);

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

  const selectRender = useMemo(() => {
    const selectedField = fields?.find((f) => f.id === value);
    if (!selectedField?.name) {
      return (
        <span className={cn('text-sm font-normal text-muted-foreground', placeholderClassName)}>
          {t('sdk:common.selectPlaceHolder')}
        </span>
      );
    }

    const { type, isLookup, name: label, aiConfig, recordRead } = selectedField;
    const { Icon } = fieldStaticGetter(type, {
      isLookup,
      isConditionalLookup: selectedField.isConditionalLookup,
      hasAiConfig: Boolean(aiConfig),
      deniedReadRecord: recordRead === false,
    });
    return (
      <div className="flex flex-1 items-center truncate">
        <Icon className="shrink-0" />
        <span className="truncate pl-1">{label}</span>
      </div>
    );
  }, [fieldStaticGetter, fields, placeholderClassName, t, value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn('justify-between truncate overflow-hidden px-3 font-normal', className)}
        >
          {selectRender}
          <ChevronDown className="ml-2 size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn('p-1', popoverClassName)}>
        <Command filter={commandFilter}>
          <CommandInput
            placeholder={placeholder}
            className="placeholder:text-sm"
            onCompositionStart={() => setIsComposing(true)}
            onCompositionEnd={() => setIsComposing(false)}
            onValueChange={(value) => setSearch(value)}
          />
          <CommandEmpty>{notFoundText}</CommandEmpty>
          <CommandList className="mt-1">
            {options?.map((option) => {
              const selectedField = fields?.find((f) => f.id === option.value);
              if (!selectedField?.name) {
                return null;
              }
              const { type, isLookup, name: label, aiConfig, recordRead } = selectedField;
              const { Icon } = fieldStaticGetter(type, {
                isLookup,
                isConditionalLookup: selectedField.isConditionalLookup,
                hasAiConfig: Boolean(aiConfig),
                deniedReadRecord: recordRead === false,
              });
              return (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    // support re-select to reset selection when cancelable is enabled
                    onChange(option.value);
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
                  <div className="flex flex-1 items-center truncate">
                    <Icon className="shrink-0" />
                    <span className="truncate pl-1">{label}</span>
                  </div>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
