'use client';

import { Audio, ChevronDown, DeepThinking, Eye, HelpCircle } from '@teable/icons';
import type { IModelDefinationMap } from '@teable/openapi';
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
import { Trans, useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { Fragment, useMemo, useState } from 'react';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { LLM_PROVIDER_ICONS } from './constant';
import { decimalToRatio, parseModelKey } from './util';

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
}: IAIModelSelectProps) {
  const [open, setOpen] = useState(false);
  const isCloud = useIsCloud();
  const currentModel = options.find(
    ({ modelKey }) => modelKey.toLowerCase() === value.toLowerCase()
  );
  const { type, name, model } = parseModelKey(currentModel?.modelKey);
  const Icon = LLM_PROVIDER_ICONS[type as keyof typeof LLM_PROVIDER_ICONS];

  const { t } = useTranslation('common');

  const { spaceOptions, instanceOptions } = useMemo(() => {
    return {
      spaceOptions: options.filter(({ isInstance }) => !isInstance),
      instanceOptions: options.filter(({ isInstance, modelKey }) => {
        const { model = '' } = parseModelKey(modelKey);
        return isInstance && !model.toLowerCase().includes('embedding');
      }),
    };
  }, [options]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          size={size}
          className={cn('grow justify-between font-normal', className)}
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
          <ChevronDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
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
                            <div className="flex items-center">
                              {t('settings.setting.system')}
                              {isCloud && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <div className="ml-1 cursor-pointer">
                                        <HelpCircle className="size-4" />
                                      </div>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                      <p className="max-w-[320px]">
                                        <Trans
                                          ns="common"
                                          i18nKey="admin.setting.ai.systemModelTips"
                                          components={{ br: <br /> }}
                                        />
                                      </p>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                            </div>
                          }
                        >
                          {instanceOptions.map(({ modelKey }) => {
                            const { type, model, name } = parseModelKey(modelKey);
                            const Icon =
                              LLM_PROVIDER_ICONS[type as keyof typeof LLM_PROVIDER_ICONS];
                            const checked = value.toLowerCase() === modelKey.toLowerCase();
                            const modelDefination = modelDefinationMap?.[model as string];
                            const {
                              inputRate,
                              outputRate,
                              visionEnable,
                              audioEnable,
                              deepThinkEnable,
                            } = modelDefination ?? {};
                            const featureList: { key: string; tooltip: string; icon: ReactNode }[] =
                              [];

                            if (visionEnable) {
                              featureList.push({
                                key: 'vision',
                                tooltip: t('admin.setting.ai.supportVisionTip'),
                                icon: <Eye className="size-4" />,
                              });
                            }
                            if (audioEnable) {
                              featureList.push({
                                key: 'audio',
                                tooltip: t('admin.setting.ai.supportAudioTip'),
                                icon: <Audio className="size-4" />,
                              });
                            }
                            // if (videoEnable) {
                            //   featureList.push({
                            //     key: 'video',
                            //     tooltip: t('admin.setting.ai.supportVideoTip'),
                            //     icon: <Video className="size-4" />,
                            //   });
                            // }
                            if (deepThinkEnable) {
                              featureList.push({
                                key: 'deepThink',
                                tooltip: t('admin.setting.ai.supportDeepThinkTip'),
                                icon: <DeepThinking className="size-4" />,
                              });
                            }

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
                                      <span className="rounded-md border px-2.5 py-0.5">
                                        {t('admin.setting.ai.input')}{' '}
                                        {decimalToRatio(inputRate as number)}
                                      </span>
                                      <span className="rounded-md border px-2.5 py-0.5">
                                        {t('admin.setting.ai.output')}{' '}
                                        {decimalToRatio(outputRate as number)}
                                      </span>
                                      {featureList.map(({ key, tooltip, icon }) => (
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
        </Command>
      </PopoverContent>
    </Popover>
  );
}
