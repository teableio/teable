import { DivideCircle } from '@teable/icons';
import type { IFieldStatic } from '@teable/sdk';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  CommandList,
  cn,
} from '@teable/ui-lib';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import { useState, useMemo } from 'react';

interface IFieldSelector {
  options: {
    value: string | null;
    label: string;
    icon: IFieldStatic['Icon'];
  }[];
  value: string | null;
  onSelect: (value: string | null) => void;
  disabled?: boolean;
}

export function FieldSelector(props: IFieldSelector) {
  const { options, onSelect, value, disabled = false } = props;
  const [open, setOpen] = useState(false);
  const { t } = useTranslation(['table', 'common']);

  const comOptions = useMemo(() => {
    const result = [...options];
    result.unshift({
      value: null,
      label: t('table:import.form.option.doNotImport'),
      icon: DivideCircle,
    });
    return result;
  }, [options, t]);

  if (!options.length) {
    return;
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={true}>
      <PopoverTrigger className="w-full" asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between truncate"
        >
          <span className="truncate">{comOptions.find((o) => o.value === value)?.label}</span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0">
        <Command>
          <CommandInput placeholder={t('table:import.tips.searchPlaceholder')} />
          <CommandEmpty>{t('table:import.tips.resultEmpty')}</CommandEmpty>
          <CommandList>
            {comOptions.map((o) => {
              const { icon: Icon } = o;
              return (
                <CommandItem
                  key={o.label}
                  value={o.value ?? ''}
                  onSelect={(value) => {
                    onSelect(value);
                    setOpen(false);
                  }}
                  className="flex hover:bg-accent"
                >
                  <Check
                    className={cn(
                      'mr-2 h-4 w-4 shrink-0',
                      value === o.value ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <div className="flex items-center truncate">
                    <Icon className="mr-1 shrink-0" />
                    <span className="truncate">{o.label}</span>
                  </div>
                </CommandItem>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
