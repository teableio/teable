import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable/ui-lib';
import React, { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useFields, useFieldStaticGetter } from '../../hooks';

interface IFieldCommand {
  onSelect?: (fieldId: string) => void;
  className?: string;
  selectedIds?: string[];
  placeholder?: string;
  emptyHolder?: React.ReactNode;
}

export function FieldCommand(props: IFieldCommand) {
  const { placeholder, emptyHolder, onSelect, selectedIds } = props;
  const { t } = useTranslation();

  const fields = useFields({ withHidden: true, withDenied: true });

  const fieldStaticGetter = useFieldStaticGetter();

  const mergeFields = useMemo(() => {
    return fields.filter((field) => (selectedIds?.length ? !selectedIds.includes(field.id) : true));
  }, [fields, selectedIds]);

  return (
    <Command className="max-w-md rounded-lg p-0 shadow-md">
      <CommandInput
        placeholder={placeholder || t('common.search.placeholder')}
        className="text-xs"
        containerClassName="border-none"
      />
      <CommandList>
        <CommandEmpty>{emptyHolder || t('common.search.empty')}</CommandEmpty>
        <CommandGroup>
          {mergeFields?.map((field) => {
            const { Icon } = fieldStaticGetter(field.type, {
              isLookup: field.isLookup,
              hasAiConfig: Boolean(field.aiConfig),
              deniedReadRecord: !field.canReadFieldRecord,
            });
            return (
              <CommandItem
                key={field.id}
                onSelect={() => {
                  onSelect?.(field.id);
                }}
                className="flex"
              >
                <Icon className="size-4 shrink-0" />
                <span className="truncate pl-3">{field.name}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}
