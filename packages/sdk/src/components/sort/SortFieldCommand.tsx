import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable-group/ui-lib';
import { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useFields, useFieldStaticGetter } from '../../hooks';

interface ISortFieldCommand {
  onSelect?: (fieldId: string) => void;
  className?: string;
  selectedFields?: string[];
}

function SortFieldCommand(props: ISortFieldCommand) {
  const { onSelect, selectedFields } = props;
  const { t } = useTranslation();

  const fields = useFields({ withHidden: true });

  const fieldStaticGetter = useFieldStaticGetter();

  const mergeFields = useMemo(() => {
    return fields.filter((field) =>
      selectedFields?.length ? !selectedFields.includes(field.id) : true
    );
  }, [fields, selectedFields]);

  return (
    <Command className="max-w-md rounded-lg p-0 shadow-md">
      <CommandInput
        placeholder={t('common.search.placeholder')}
        className="text-xs"
        containerClassName="border-none"
      />
      <CommandList>
        <CommandEmpty>{t('common.search.empty')}</CommandEmpty>
        <CommandGroup>
          {mergeFields?.map((field) => {
            const { Icon } = fieldStaticGetter(field.type, field.isLookup);
            return (
              <CommandItem key={field.id} onSelect={() => onSelect?.(field.id)} className="flex">
                <Icon className="shrink-0"></Icon>
                <span className="truncate pl-3">{field.name}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export { SortFieldCommand };
