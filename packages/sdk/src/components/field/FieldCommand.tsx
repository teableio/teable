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
import { useInDrawer } from '../adaptive-panel';

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
    className,
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

  // Inside a drawer the list is the panel, not a card floating over one:
  // shed the rounding/shadow/max-width and switch to the taller touch rows.
  const inDrawer = useInDrawer();

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
        className={cn(
          'flex',
          inDrawer && 'h-9 gap-2 rounded-md px-3',
          disabled && 'pointer-events-none opacity-50'
        )}
      >
        <Icon className="size-4 shrink-0" />
        <span className={cn('truncate ps-3', inDrawer && 'ps-0')}>{field.name}</span>
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
    <Command
      className={cn(
        'max-w-md rounded-lg p-0 shadow-md',
        inDrawer && 'h-full max-w-none rounded-none bg-transparent shadow-none',
        className
      )}
    >
      <CommandInput
        placeholder={placeholder || t('common.search.placeholder')}
        className={cn('text-xs', inDrawer && 'h-8 text-sm')}
        containerClassName={cn(
          // `border-none` (border-style) and `border` (border-width) live in
          // different tailwind-merge groups, so both survive and the drawer
          // box paints no outline. Pick one branch instead of layering them.
          inDrawer
            ? 'mx-4 mb-1 mt-4 h-8 shrink-0 gap-2 rounded-md border border-input px-3 py-0'
            : 'border-none'
        )}
      />
      <CommandList
        className={cn(inDrawer && 'max-h-full flex-1 p-2')}
        style={maxHeight ? { maxHeight } : undefined}
      >
        <CommandEmpty>{emptyHolder || t('common.search.empty')}</CommandEmpty>
        <CommandGroup heading={groupHeading}>{mergeFields?.map(renderFieldItem)}</CommandGroup>
      </CommandList>
    </Command>
  );
}
