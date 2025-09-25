'use client';

import { ChevronDown, Plus } from '@teable/icons';
import type { IModelDefinationMap } from '@teable/openapi';
import { useBase } from '@teable/sdk/hooks';
import { Button } from '@teable/ui-lib';
import {
  cn,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  Popover,
  PopoverContent,
  PopoverTrigger,
  ScrollArea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { Check } from 'lucide-react';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { Fragment, useMemo, useState } from 'react';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { LLM_PROVIDER_ICONS } from './constant';
import { parseModelKey, processModelDefinition, isImageOutputModel } from './utils';

export interface IModelOption {
  isInstance?: boolean;
  modelKey: string;
}

interface IAIModelSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  size?: 'xs' | 'sm' | 'lg' | 'default' | null | undefined;
  className?: string;
  options?: IModelOption[];
  disabled?: boolean;
  needGroup?: boolean;
  modelDefinationMap?: IModelDefinationMap;
  children?: ReactNode;
  onlyImageOutput?: boolean; // if true, only show image output models
}

export function AIModelSelect({
  value = '',
  onValueChange: setValue,
  size = 'default',
  className,
  options = [],
  disabled,
  modelDefinationMap,
  needGroup,
  children,
  onlyImageOutput = false,
}: IAIModelSelectProps) {
  const base = useBase();
  const router = useRouter();
  const isCloud = useIsCloud();
  const { t } = useTranslation('common');

  const [open, setOpen] = useState(false);
  const currentModel = options.find(
    ({ modelKey }) => modelKey.toLowerCase() === value.toLowerCase()
  );
  const { type, name, model } = parseModelKey(currentModel?.modelKey);
  const Icon = LLM_PROVIDER_ICONS[type as keyof typeof LLM_PROVIDER_ICONS];

  const { spaceOptions, instanceOptions } = useMemo(() => {
    const filterImageOutput = (model: string) => {
      if (!onlyImageOutput) return true;
      const modelDefination = modelDefinationMap?.[model];
      return isImageOutputModel(modelDefination);
    };

    return {
      spaceOptions: options.filter(({ isInstance }) => !isInstance),
      instanceOptions: options.filter(({ isInstance, modelKey }) => {
        const { model = '' } = parseModelKey(modelKey);
        return isInstance && !model.toLowerCase().includes('embedding') && filterImageOutput(model);
      }),
    };
  }, [options, onlyImageOutput, modelDefinationMap]);

  const onLinkIntegration = () => {
    router.push({
      pathname: '/space/[spaceId]/setting/ai-setting',
      query: { spaceId: base.spaceId },
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild disabled={disabled}>
        {children ?? (
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            size={size}
            className={cn('grow justify-between font-normal flex', className)}
          >
            <div className="flex flex-1 items-center truncate">
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
            <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-full p-0">
        <Command>
          <CommandInput placeholder={t('admin.setting.ai.searchModel')} />
          <CommandEmpty>{t('admin.setting.ai.noModelFound')}</CommandEmpty>
          <ScrollArea className="w-full">
            <div className="max-h-[500px]">
              <CommandList>
                {needGroup ? (
                  <Fragment>
                    {!!spaceOptions.length && (
                      <CommandGroup heading={t('noun.space')}>
                        {spaceOptions.map(({ modelKey }) => {
                          const { type, model, name } = parseModelKey(modelKey);
                          const Icon = LLM_PROVIDER_ICONS[type as keyof typeof LLM_PROVIDER_ICONS];
                          const checked = value.toLowerCase() === modelKey.toLowerCase();
                          return (
                            <CommandItem
                              key={modelKey}
                              value={modelKey}
                              onSelect={(modelKey) => {
                                setValue(checked ? '' : modelKey);
                                setOpen(false);
                              }}
                            >
                              <div className="flex items-center">
                                <Check
                                  className={cn(
                                    'mr-2 size-4',
                                    checked ? 'opacity-100' : 'opacity-0'
                                  )}
                                />
                                <p className="mr-1 max-w-[300px] truncate">{name}</p>
                                <div className="flex items-center rounded-sm bg-foreground px-1 py-[2px] text-xs text-background">
                                  <Icon className="size-4 shrink-0 pr-1" />
                                  {model}
                                </div>
                              </div>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    )}
                    {!!instanceOptions.length && (
                      <Fragment>
                        <CommandSeparator />
                        <CommandGroup
                          heading={
                            <div className="flex items-center">{t('settings.setting.system')}</div>
                          }
                        >
                          {instanceOptions.map(({ modelKey }) => {
                            const { type, model, name } = parseModelKey(modelKey);
                            const Icon =
                              LLM_PROVIDER_ICONS[type as keyof typeof LLM_PROVIDER_ICONS];
                            const checked = value.toLowerCase() === modelKey.toLowerCase();
                            const modelDefination = modelDefinationMap?.[model as string];
                            const { usageTags, featureTags } = processModelDefinition(
                              modelDefination,
                              t
                            );

                            return (
                              <CommandItem
                                key={modelKey}
                                value={modelKey}
                                onSelect={(modelKey) => {
                                  setValue(
                                    modelKey.toLowerCase() === value.toLowerCase() ? '' : modelKey
                                  );
                                  setOpen(false);
                                }}
                              >
                                <div className="w-full flex-col space-y-1">
                                  <div className="flex items-center">
                                    <Check
                                      className={cn(
                                        'mr-2 size-4',
                                        checked ? 'opacity-100' : 'opacity-0'
                                      )}
                                    />
                                    <p className="mr-1 max-w-[300px] truncate">{name}</p>
                                    <div className="flex items-center rounded-sm bg-foreground px-1 py-[2px] text-xs text-background">
                                      <Icon className="size-4 shrink-0 pr-1" />
                                      {model}
                                    </div>
                                  </div>
                                  {isCloud && modelDefination && (
                                    <div className="ml-6 flex items-center space-x-1 text-xs text-slate-500">
                                      {usageTags.map(({ key, text, tooltip }) => (
                                        <TooltipProvider key={key}>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className="rounded-md border px-2.5 py-0.5">
                                                {text}
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p className="max-w-[320px]">{tooltip}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      ))}
                                      {featureTags.map(({ key, tooltip, icon }) => (
                                        <TooltipProvider key={key}>
                                          <Tooltip>
                                            <TooltipTrigger asChild>
                                              <span className="rounded-md border p-0.5">
                                                {icon}
                                              </span>
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              <p className="max-w-[320px]">{tooltip}</p>
                                            </TooltipContent>
                                          </Tooltip>
                                        </TooltipProvider>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      </Fragment>
                    )}
                  </Fragment>
                ) : (
                  <Fragment>
                    {spaceOptions.map(({ modelKey }) => {
                      const { type, model, name } = parseModelKey(modelKey);
                      const Icon = LLM_PROVIDER_ICONS[type as keyof typeof LLM_PROVIDER_ICONS];
                      const checked = value.toLowerCase() === modelKey.toLowerCase();
                      return (
                        <CommandItem
                          key={modelKey}
                          value={modelKey}
                          onSelect={(modelKey) => {
                            setValue(checked ? '' : modelKey);
                            setOpen(false);
                          }}
                        >
                          <div className="flex items-center">
                            <Check
                              className={cn('mr-2 size-4', checked ? 'opacity-100' : 'opacity-0')}
                            />
                            <p className="mr-1 max-w-[300px] truncate">{name}</p>
                            <div className="flex items-center rounded-sm bg-foreground px-1 py-[2px] text-xs text-background">
                              <Icon className="size-4 shrink-0 pr-1" />
                              {model}
                            </div>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </Fragment>
                )}
              </CommandList>
            </div>
          </ScrollArea>
          {needGroup && (
            <Fragment>
              {Boolean(spaceOptions.length || instanceOptions.length) && <CommandSeparator />}
              <CommandItem
                className="flex items-center justify-center gap-2 text-[13px] text-muted-foreground"
                onSelect={onLinkIntegration}
              >
                <Plus className="size-4" />
                {t('admin.setting.ai.addCustomModel')}
              </CommandItem>
            </Fragment>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
