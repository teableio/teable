import {
  Switch,
  Label,
  Button,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@teable-group/ui-lib';
import React from 'react';
import { useViewId, useFields, useFieldStaticGetter } from '../../hooks';
import type { IFieldInstance } from '../../model';

export const HideFields: React.FC<{
  children: (text: string, isActive: boolean) => React.ReactNode;
}> = ({ children }) => {
  const activeViewId = useViewId();
  const fields = useFields({ withHidden: true });
  const fieldStaticGetter = useFieldStaticGetter();

  const filterFields = (fields: IFieldInstance[], shouldBeHidden?: boolean) =>
    fields.filter(
      (field) =>
        activeViewId &&
        !field.isPrimary &&
        (!shouldBeHidden || field.columnMeta[activeViewId]?.hidden === shouldBeHidden)
    );

  const fieldData = filterFields(fields);
  const hiddenCount = filterFields(fields, true).length;

  const updateColumnHiddenStatus = (status: boolean) => {
    fieldData
      .filter((field) => activeViewId && field.columnMeta[activeViewId]?.hidden !== status)
      .forEach((field) => activeViewId && field.updateColumnHidden(activeViewId, status));
  };

  const handleDeselectAll = () => updateColumnHiddenStatus(true);
  const handleSelectAll = () => updateColumnHiddenStatus(false);

  const content = () => (
    <div className="rounded-lg border shadow-md p-1">
      <Command>
        <CommandInput placeholder="Search a field" className="h-8 text-xs" />
        <CommandList className="my-2">
          <CommandEmpty>No results found.</CommandEmpty>
          {fieldData.map((field) => {
            const { id, name, type, isLookup } = field;
            const { Icon } = fieldStaticGetter(type, isLookup);
            return (
              <CommandItem className="flex p-0" key={id}>
                <Label
                  htmlFor={id}
                  className="flex flex-1 p-2 cursor-pointer items-center truncate"
                >
                  <Switch
                    id={id}
                    className="scale-75"
                    checked={Boolean(activeViewId && !field.columnMeta[activeViewId]?.hidden)}
                    onCheckedChange={(checked) => {
                      activeViewId && field.updateColumnHidden(activeViewId, !checked);
                    }}
                  />
                  <Icon className="shrink-0 ml-2" />
                  <span className="flex-1 pl-1 cursor-pointer h-full truncate text-sm">{name}</span>
                </Label>
              </CommandItem>
            );
          })}
        </CommandList>
      </Command>
      <div className="flex justify-between p-2">
        <Button
          variant="secondary"
          size="xs"
          className="w-32 text-muted-foreground hover:text-secondary-foreground"
          onClick={handleSelectAll}
        >
          Show All
        </Button>
        <Button
          variant="secondary"
          size="xs"
          className="w-32 text-muted-foreground hover:text-secondary-foreground"
          onClick={handleDeselectAll}
        >
          Hide All
        </Button>
      </div>
    </div>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children(
          hiddenCount ? `${hiddenCount} hidden field(s)` : 'Hide fields',
          Boolean(hiddenCount)
        )}
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="p-0 border-0">
        {content()}
      </PopoverContent>
    </Popover>
  );
};
