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
import { LLM_PROVIDER_ICONS } from './constant';
import { parseModelKey } from './util';

interface IAIModelSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  size?: 'xs' | 'sm' | 'lg' | 'default' | null | undefined;
  className?: string;
  options?: string[];
  disabled?: boolean;
}

export function AIModelSelect({
  value = '',
  onValueChange: setValue,
  size = 'default',
  className,
  options = [],
  disabled,
}: IAIModelSelectProps) {
  const [open, setOpen] = React.useState(false);
  const currentModel = options.find((model) => model.toLowerCase() === value.toLowerCase());
  const { type, name, model } = parseModelKey(currentModel);
  const Icon = LLM_PROVIDER_ICONS[type as keyof typeof LLM_PROVIDER_ICONS];

  const { t } = useTranslation('common');

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          size={size}
          className={cn('grow justify-between', className)}
        >
          <div className="flex max-w-[300px] items-center truncate sm:max-w-full">
            {!currentModel ? (
              t('admin.setting.ai.selectModel')
            ) : (
              <>
                <div className="mr-1 max-w-[300px] truncate">{name}</div>
                <div className="flex items-center rounded-sm bg-foreground px-1 py-[2px] text-xs text-background">
                  <Icon className="size-4 shrink-0 pr-1" />
                  {model}
                </div>
              </>
            )}
          </div>
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
                {options.map((modelKey) => {
                  const { type, model, name } = parseModelKey(modelKey);
                  const Icon = LLM_PROVIDER_ICONS[type as keyof typeof LLM_PROVIDER_ICONS];
                  return (
                    <CommandItem
                      key={modelKey}
                      value={modelKey}
                      onSelect={(modelKey) => {
                        setValue(modelKey.toLowerCase() === value.toLowerCase() ? '' : modelKey);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          value.toLowerCase() === modelKey.toLowerCase()
                            ? 'opacity-100'
                            : 'opacity-0'
                        )}
                      />
                      <p className="mr-1 max-w-[300px] truncate">{name}</p>
                      <div className="flex items-center rounded-sm bg-foreground px-1 py-[2px] text-xs text-background">
                        <Icon className="size-4 shrink-0 pr-1" />
                        {model}
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandList>
            </div>
          </ScrollArea>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
