import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable-group/ui-lib';
import { useMemo } from 'react';
import { useFields, useFieldStaticGetter } from '../../hooks';

interface ISortFieldCommand {
  onSelect?: (fieldId: string) => void;
  className?: string;
  selectedFields?: string[];
}

function SortFieldCommand(props: ISortFieldCommand) {
  const { onSelect, selectedFields } = props;

  const fields = useFields({ widthHidden: true });

  const fieldStaticGetter = useFieldStaticGetter();

  const mergeFields = useMemo(() => {
    return fields.filter((field) =>
      selectedFields?.length ? !selectedFields.includes(field.id) : true
    );
  }, [fields, selectedFields]);

  return (
    <Command className="rounded-lg shadow-md p-0 max-w-md">
      <CommandInput placeholder="Search..." className="text-xs" containerClassName="border-none" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup>
          {mergeFields?.length ? (
            mergeFields.map((field) => {
              const { Icon } = fieldStaticGetter(field.type, field.isLookup);
              return (
                <CommandItem key={field.id} onSelect={() => onSelect?.(field.id)} className="flex">
                  <Icon className="shrink-0"></Icon>
                  <span className="pl-3 truncate">{field.name}</span>
                </CommandItem>
              );
            })
          ) : (
            <div className="py-6 text-center text-sm"> No results found.</div>
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  );
}

export { SortFieldCommand };
