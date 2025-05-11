import { FieldType } from '@teable/core';
import { ChevronsUpDown } from '@teable/icons';
import { Button, Popover, PopoverTrigger, PopoverContent, cn } from '@teable/ui-lib';
import { useState, useMemo } from 'react';
import { useFields, useFieldStaticGetter } from '../../hooks';
import { FieldCommand } from './FieldCommand';

interface IFieldSelector {
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
  } = props;

  const [open, setOpen] = useState(false);

  const fields = useFields({ withHidden: true, withDenied: true });
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
            className={cn('h-8 max-w-[200px] flex items-center', className)}
          >
            <div className="flex flex-1 items-center truncate">
              <Icon className="size-4 shrink-0 opacity-50" />
              <span className="min-w-8 truncate pl-1 text-left">{selectedField?.name}</span>
            </div>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        )}
      </PopoverTrigger>

      <PopoverContent className="w-[200px] p-0" container={props.container}>
        <FieldCommand
          selectedIds={selectedIds}
          placeholder={placeholder}
          emptyHolder={emptyHolder}
          onSelect={selectHandler}
        />
      </PopoverContent>
    </Popover>
  );
}
