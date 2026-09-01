import { FieldType } from '@teable/core';
import { ChevronDown } from '@teable/icons';
import { Button, Popover, PopoverTrigger, PopoverContent, cn } from '@teable/ui-lib';
import { useState, useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useFields, useFieldStaticGetter, useTables } from '../../hooks';
import type { IFieldInstance } from '../../model';
import { NestedDrawer, useInDrawer } from '../adaptive-panel';
import { FieldCommand } from './FieldCommand';

interface IFieldSelector {
  fields?: IFieldInstance[];
  value?: string;
  className?: string;
  excludedIds?: string[];
  container?: HTMLElement;
  onSelect?: (value: string) => void;
  withHidden?: boolean;
  placeholder?: string;
  emptyHolder?: React.ReactNode;
  children?: React.ReactNode;
  modal?: boolean;
  showTableName?: boolean;
  tableId?: string;
  tableName?: string;
  isOptionDisabled?: (field: IFieldInstance) => boolean;
  getDisabledReason?: (field: IFieldInstance) => string | undefined;
  maxHeight?: number;
  /** Heading of the stacked drawer. Ignored outside a drawer. */
  drawerTitle?: string;
}

export function FieldSelector(props: IFieldSelector) {
  const {
    value,
    className,
    excludedIds: selectedIds,
    placeholder,
    emptyHolder,
    onSelect,
    children,
    modal = false,
    fields: propsFields,
    showTableName = false,
    tableId: tableIdProp,
    tableName: tableNameProp,
    isOptionDisabled,
    getDisabledReason,
    maxHeight,
    drawerTitle,
  } = props;

  const { t } = useTranslation();
  const inDrawer = useInDrawer();
  const [open, setOpen] = useState(false);

  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = propsFields ?? defaultFields;

  const selectedField = useMemo(() => fields.find((f) => f.id === value), [fields, value]);

  const fieldStaticGetter = useFieldStaticGetter();

  const tables = useTables();

  const { Icon } = fieldStaticGetter(selectedField?.type || FieldType.SingleLineText, {
    isLookup: selectedField?.isLookup,
    isConditionalLookup: selectedField?.isConditionalLookup,
    hasAiConfig: Boolean(selectedField?.aiConfig),
    deniedReadRecord: !selectedField?.canReadFieldRecord,
  });

  const tableId = useMemo(() => {
    if (!showTableName) {
      return undefined;
    }
    if (tableIdProp) {
      return tableIdProp;
    }
    if (selectedField?.tableId) {
      return selectedField.tableId;
    }
    return fields[0]?.tableId;
  }, [fields, selectedField?.tableId, showTableName, tableIdProp]);

  const tableHeading = useMemo(() => {
    if (!showTableName) {
      return undefined;
    }
    if (tableNameProp) {
      return tableNameProp;
    }
    if (!tableId) {
      return undefined;
    }
    return tables?.find((table) => table.id === tableId)?.name;
  }, [showTableName, tableNameProp, tableId, tables]);

  const selectHandler = (value: string) => {
    setOpen(false);
    onSelect?.(value);
  };

  const trigger = children ?? (
    <Button
      variant="outline"
      role="combobox"
      // Keyboard users must be able to reach this control inside a drawer;
      // the desktop popover keeps its original roving-focus behaviour.
      tabIndex={inDrawer ? undefined : -1}
      aria-expanded={open}
      className={cn(
        'h-9 max-w-[200px] px-3 flex items-center dark:bg-[color-mix(in_oklab,white_10%,hsl(var(--background)))]',
        inDrawer && 'max-w-none w-full',
        className
      )}
    >
      <div className="flex flex-1 items-center gap-1 truncate">
        <Icon className="size-4 shrink-0" />
        <span className="min-w-8 truncate ps-1 text-start text-sm font-normal">
          {selectedField?.name}
        </span>
      </div>
      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
    </Button>
  );

  const fieldCommand = (
    <FieldCommand
      fields={fields}
      selectedIds={selectedIds}
      placeholder={placeholder}
      emptyHolder={emptyHolder}
      onSelect={selectHandler}
      groupHeading={tableHeading}
      isDisabled={isOptionDisabled}
      getDisabledReason={getDisabledReason}
      maxHeight={inDrawer ? undefined : maxHeight}
    />
  );

  if (inDrawer) {
    return (
      <NestedDrawer
        open={open}
        onOpenChange={setOpen}
        title={drawerTitle ?? t('common.selectField')}
        // Pinned height: the list has a search box, and a panel that resized
        // on every keystroke would shift the rows under the user's finger.
        size="list"
        content={fieldCommand}
      >
        {trigger}
      </NestedDrawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>

      <PopoverContent className="w-[200px] p-0" container={props.container}>
        {fieldCommand}
      </PopoverContent>
    </Popover>
  );
}
