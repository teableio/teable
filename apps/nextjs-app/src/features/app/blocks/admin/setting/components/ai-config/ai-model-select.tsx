'use client';

import { Button } from '@teable/ui-lib';
import {
  cn,
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
} from '@teable/ui-lib/shadcn';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import * as React from 'react';

export function AIModelSelect({
  value = '',
  onValueChange: setValue,
  size = 'default',
  className,
  options = [],
}: {
  onValueChange: (value: string) => void;
  value: string;
  size?: 'xs' | 'sm' | 'lg' | 'default' | null | undefined;
  className?: string;
  options?: string[];
}) {
  const [open, setOpen] = React.useState(false);
  const currentModel = options.find((model) => model.toLowerCase() === value.toLowerCase());
  const { t } = useTranslation('common');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          size={size}
          className={cn('grow justify-between', className)}
        >
          <p className="max-w-[200px] truncate sm:max-w-full">
            {currentModel ?? t('admin.setting.ai.selectModel')}
          </p>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput placeholder={t('admin.setting.ai.searchModel')} />
          <CommandEmpty>{t('admin.setting.ai.noModelFound')}</CommandEmpty>
          <ScrollArea className="w-full">
            <div className="max-h-[500px]">
              <CommandList>
                {options.map((model) => (
                  <CommandItem
                    key={model}
                    value={model}
                    onSelect={(model) => {
                      setValue(model.toLowerCase() === value.toLowerCase() ? '' : model);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value.toLowerCase() === model.toLowerCase() ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <p className="max-w-[300px] truncate">{model}</p>{' '}
                  </CommandItem>
                ))}
              </CommandList>
            </div>
          </ScrollArea>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
