import type { Table } from '@teable/sdk/model';
import ArrowDownIcon from '@teable/ui-lib/icons/app/arrow-down.svg';
import SelectIcon from '@teable/ui-lib/icons/app/select.svg';
import { cn } from '@teable/ui-lib/shadcn';
import { Button } from '@teable/ui-lib/shadcn/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@teable/ui-lib/shadcn/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@teable/ui-lib/shadcn/ui/popover';
import { useTranslation } from 'next-i18next';
import { useRef, useState } from 'react';
import { tableConfig } from '@/features/i18n/table.config';

export const SelectTable = (props: {
  value?: string;
  tables?: Table[];
  onChange?: (id: string) => void;
}) => {
  const { value = '', onChange, tables = [] } = props;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation(tableConfig.i18nNamespaces);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          {value
            ? tables.find(({ id }) => id === value)?.name
            : t('table:field.editor.selectTable')}
          <ArrowDownIcon className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0" style={{ width: ref.current?.offsetWidth }}>
        <Command>
          <CommandInput placeholder={t('table:field.editor.searchTable')} />
          <CommandEmpty>{t('common:noResult')}</CommandEmpty>
          <CommandGroup>
            {tables.map(({ id, name }) => (
              <CommandItem
                key={id}
                value={id}
                onSelect={() => {
                  onChange?.(id);
                  setOpen(false);
                }}
              >
                <SelectIcon
                  className={cn('mr-2 h-4 w-4', value === id ? 'opacity-100' : 'opacity-0')}
                />
                {name}
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
