import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  cn,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib';
import React, { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useFields, useFieldStaticGetter } from '../../hooks';
import type { IFieldInstance } from '../../model';

interface IFieldCommand {
  fields?: IFieldInstance[];
  onSelect?: (fieldId: string) => void;
  className?: string;
  selectedIds?: string[];
  placeholder?: string;
  emptyHolder?: React.ReactNode;
  groupHeading?: string;
  isDisabled?: (field: IFieldInstance) => boolean;
  getDisabledReason?: (field: IFieldInstance) => string | undefined;
  maxHeight?: number;
}

export function FieldCommand(props: IFieldCommand) {
  const {
    placeholder,
    emptyHolder,
    onSelect,
    selectedIds,
    fields: propsFields,
    groupHeading,
    isDisabled,
    getDisabledReason,
    maxHeight,
  } = props;
  const { t } = useTranslation();

  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = propsFields ?? defaultFields;

  const fieldStaticGetter = useFieldStaticGetter();

  const mergeFields = useMemo(() => {
    return fields.filter((field) => (selectedIds?.length ? !selectedIds.includes(field.id) : true));
  }, [fields, selectedIds]);

  const renderFieldItem = (field: IFieldInstance) => {
    const { Icon } = fieldStaticGetter(field.type, {
      isLookup: field.isLookup,
      isConditionalLookup: field.isConditionalLookup,
      hasAiConfig: Boolean(field.aiConfig),
      deniedReadRecord: !field.canReadFieldRecord,
    });
    const disabled = isDisabled?.(field) ?? false;
    const disabledReason = disabled ? getDisabledReason?.(field) : undefined;

    const itemContent = (
      <CommandItem
        key={field.id}
        disabled={disabled}
        onSelect={() => {
          if (disabled) {
            return;
          }
          onSelect?.(field.id);
        }}
        className={cn('flex', disabled && 'pointer-events-none opacity-50')}
      >
        <Icon className="size-4 shrink-0" />
        <span className="truncate pl-3">{field.name}</span>
      </CommandItem>
    );

    if (disabled && disabledReason) {
      return (
        <TooltipProvider key={field.id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>{itemContent}</div>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p className="max-w-[200px] text-xs">{disabledReason}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return itemContent;
  };

  return (
    <Command className="max-w-md rounded-lg p-0 shadow-md">
      <CommandInput
        placeholder={placeholder || t('common.search.placeholder')}
        className="text-xs"
        containerClassName="border-none"
      />
      <CommandList style={maxHeight ? { maxHeight } : undefined}>
        <CommandEmpty>{emptyHolder || t('common.search.empty')}</CommandEmpty>
        <CommandGroup heading={groupHeading}>{mergeFields?.map(renderFieldItem)}</CommandGroup>
      </CommandList>
    </Command>
  );
}
