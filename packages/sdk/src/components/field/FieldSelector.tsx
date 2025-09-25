import { FieldType } from '@teable/core';
import { ChevronDown } from '@teable/icons';
import { Button, Popover, PopoverTrigger, PopoverContent, cn } from '@teable/ui-lib';
import { useState, useMemo } from 'react';
import { useFields, useFieldStaticGetter } from '../../hooks';
import type { IFieldInstance } from '../../model';
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
  } = props;

  const [open, setOpen] = useState(false);

  const defaultFields = useFields({ withHidden: true, withDenied: true });
  const fields = propsFields ?? defaultFields;

  const selectedField = useMemo(() => fields.find((f) => f.id === value), [fields, value]);

  const fieldStaticGetter = useFieldStaticGetter();

  const { Icon } = fieldStaticGetter(selectedField?.type || FieldType.SingleLineText, {
    isLookup: selectedField?.isLookup,
    hasAiConfig: Boolean(selectedField?.aiConfig),
    deniedReadRecord: !selectedField?.canReadFieldRecord,
  });

  const selectHandler = (value: string) => {
    setOpen(false);
    onSelect?.(value);
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>
        {children ? (
          children
        ) : (
          <Button
            variant="outline"
            role="combobox"
            tabIndex={-1}
            aria-expanded={open}
            className={cn('h-9 max-w-[200px] px-3 flex items-center', className)}
          >
            <div className="flex flex-1 items-center gap-1 truncate">
              <Icon className="size-4 shrink-0" />
              <span className="min-w-8 truncate pl-1 text-left text-sm font-normal">
                {selectedField?.name}
              </span>
            </div>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent className="w-[200px] p-0" container={props.container}>
        <FieldCommand
          fields={fields}
          selectedIds={selectedIds}
          placeholder={placeholder}
          emptyHolder={emptyHolder}
          onSelect={selectHandler}
        />
      </PopoverContent>
    </Popover>
  );
}
