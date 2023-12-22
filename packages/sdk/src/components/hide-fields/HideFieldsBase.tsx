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
import { map } from 'lodash';
import React, { useMemo } from 'react';
import { useTranslation } from '../../context/app/i18n';
import { useFieldStaticGetter } from '../../hooks';
import type { IFieldInstance } from '../../model';

interface IHideFieldsBaseProps {
  fields: IFieldInstance[];
  hidden: string[];
  children: React.ReactNode;
  onChange: (hidden: string[]) => void;
}

export const HideFieldsBase = (props: IHideFieldsBaseProps) => {
  const { fields, hidden, children, onChange } = props;
  const fieldStaticGetter = useFieldStaticGetter();
  const { t } = useTranslation();

  const statusMap = useMemo(() => {
    return fields.reduce(
      (acc, field) => {
        acc[field.id] = !hidden.includes(field.id);
        return acc;
      },
      {} as Record<string, boolean>
    );
  }, [fields, hidden]);

  const switchChange = (id: string, checked: boolean) => {
    if (checked) {
      onChange(hidden.filter((fieldId) => fieldId !== id));
      return;
    }
    onChange([...hidden, id]);
  };

  const showAll = () => {
    onChange([]);
  };

  const hideAll = () => {
    const hiddenFields = fields.filter((field) => !field.isPrimary);
    onChange(map(hiddenFields, 'id'));
  };

  const content = () => (
    <div className="rounded-lg border p-1 shadow-md">
      <Command>
        <CommandInput placeholder="Search a field" className="h-8 text-xs" />
        <CommandList className="my-2">
          <CommandEmpty>{t('common.search.empty')}</CommandEmpty>
          {fields.map((field) => {
            const { id, name, type, isLookup } = field;
            const { Icon } = fieldStaticGetter(type, isLookup);
            return (
              <CommandItem className="flex p-0" key={id}>
                <Label
                  htmlFor={id}
                  className="flex flex-1 cursor-pointer items-center truncate p-2"
                >
                  <Switch
                    id={id}
                    className="scale-75"
                    checked={statusMap[id]}
                    onCheckedChange={(checked) => {
                      switchChange(id, checked);
                    }}
                  />
                  <Icon className="ml-2 shrink-0" />
                  <span className="h-full flex-1 cursor-pointer truncate pl-1 text-sm">{name}</span>
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
          onClick={showAll}
        >
          {t('hidden.showAll')}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          className="w-32 text-muted-foreground hover:text-secondary-foreground"
          onClick={hideAll}
        >
          {t('hidden.hideAll')}
        </Button>
      </div>
    </div>
  );

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="border-0 p-0">
        {content()}
      </PopoverContent>
    </Popover>
  );
};
