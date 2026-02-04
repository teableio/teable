'use client';

import { Plus } from '@teable/icons';
import {
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
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { Fragment, useCallback, useMemo, useState } from 'react';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import {
  GatewayModelOption,
  ModelSelectTrigger,
  ProviderModelOption,
  useGatewayModels,
  useModelCategories,
} from './ai-model-select';
import type { IAIModelSelectProps, IModelOption } from './ai-model-select/types';
import type { IPickerModel } from './GatewayModelPickerDialog';
import { GatewayModelPickerDialog } from './GatewayModelPickerDialog';

// Re-export types for backward compatibility
export type { IModelOption } from './ai-model-select/types';

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
  const isCloud = useIsCloud();
  const { t } = useTranslation('common');

  const [open, setOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Use custom hooks for gateway models and model categories
  const {
    isLoadingGateway,
    gatewayConfigured,
    pickerModels,
    selectedModelIdForPicker,
    findGatewayModel,
  } = useGatewayModels({
    needGroup,
    onlyImageOutput,
    value,
    options,
  });

  const { gatewayOptions, spaceOptions, instanceOptions } = useModelCategories({
    options,
    onlyImageOutput,
    modelDefinationMap,
  });

  // Find current model
  const currentModel = useMemo(() => findGatewayModel(value), [findGatewayModel, value]);

  // Handle model selection
  const handleSelect = useCallback(
    (modelKey: string, isSelected: boolean) => {
      setValue(isSelected ? '' : modelKey);
      setOpen(false);
    },
    [setValue]
  );

  // Handle model selection from picker dialog
  const handlePickerModelSelect = useCallback(
    (model: IPickerModel) => {
      const modelKey = `aiGateway@${model.id}@teable`;
      setValue(modelKey);
      setPickerOpen(false);
      setOpen(false);
    },
    [setValue]
  );

  // Check if model is selected
  const isModelSelected = useCallback(
    (modelKey: string) => value.toLowerCase() === modelKey.toLowerCase(),
    [value]
  );

  // Render gateway model options
  const renderGatewayOptions = (
    options: IModelOption[],
    showGroupHeading = false,
    showSeparator = false
  ) => {
    const content = options.map((option) => (
      <GatewayModelOption
        key={option.modelKey}
        option={option}
        isSelected={isModelSelected(option.modelKey)}
        showPrice={isCloud}
        onSelect={handleSelect}
      />
    ));

    if (showGroupHeading) {
      return (
        <Fragment>
          {showSeparator && <CommandSeparator />}
          <CommandGroup heading={<span>{t('admin.setting.ai.recommended')}</span>}>
            {content}
          </CommandGroup>
        </Fragment>
      );
    }

    if (!options.length) return null;
    return content;
  };

  // Render space model options
  const renderSpaceOptions = (options: IModelOption[], showSeparator = false) => {
    if (!options.length) return null;

    return (
      <Fragment>
        {showSeparator && <CommandSeparator />}
        <CommandGroup heading={t('noun.space')}>
          {options.map((option) => (
            <ProviderModelOption
              key={option.modelKey}
              option={option}
              isSelected={isModelSelected(option.modelKey)}
              onSelect={handleSelect}
            />
          ))}
        </CommandGroup>
      </Fragment>
    );
  };

  // Render instance model options
  const renderInstanceOptions = (options: IModelOption[]) => {
    if (!options.length) return null;

    return (
      <Fragment>
        <CommandSeparator />
        <CommandGroup
          heading={<div className="flex items-center">{t('settings.setting.system')}</div>}
        >
          {options.map((option) => (
            <ProviderModelOption
              key={option.modelKey}
              option={option}
              isSelected={isModelSelected(option.modelKey)}
              onSelect={handleSelect}
              modelDefinationMap={modelDefinationMap}
              t={t}
              showPriceInfo
            />
          ))}
        </CommandGroup>
      </Fragment>
    );
  };

  // Render all provider options (space + instance) for non-grouped view
  const renderProviderOptions = (spaceOpts: IModelOption[], instanceOpts: IModelOption[]) => {
    const allOptions = [...spaceOpts, ...instanceOpts];
    if (!allOptions.length) return null;

    return allOptions.map((option) => (
      <ProviderModelOption
        key={option.modelKey}
        option={option}
        isSelected={isModelSelected(option.modelKey)}
        onSelect={handleSelect}
      />
    ));
  };

  const hasAnyOptions =
    gatewayOptions.length > 0 || spaceOptions.length > 0 || instanceOptions.length > 0;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen} modal>
        <PopoverTrigger asChild disabled={disabled}>
          {children ?? (
            <ModelSelectTrigger
              currentModel={currentModel}
              value={value}
              size={size}
              className={className}
              open={open}
            />
          )}
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
          <Command>
            <CommandInput placeholder={t('admin.setting.ai.searchModel')} />
            <CommandEmpty>{t('admin.setting.ai.noModelFound')}</CommandEmpty>
            <ScrollArea className="w-full">
              <div className="max-h-[500px]">
                <CommandList>
                  {needGroup ? (
                    <Fragment>
                      {renderSpaceOptions(spaceOptions, false)}
                      {renderGatewayOptions(gatewayOptions, true, !!spaceOptions.length)}
                      {renderInstanceOptions(instanceOptions)}
                    </Fragment>
                  ) : (
                    <Fragment>
                      {renderGatewayOptions(gatewayOptions)}
                      {renderProviderOptions(spaceOptions, instanceOptions)}
                    </Fragment>
                  )}
                </CommandList>
              </div>
            </ScrollArea>
            {needGroup && gatewayConfigured === true && (
              <Fragment>
                {hasAnyOptions && <CommandSeparator />}
                <CommandItem
                  className="flex items-center justify-center gap-2 text-[13px] text-muted-foreground"
                  onSelect={() => {
                    setPickerOpen(true);
                  }}
                >
                  <Plus className="size-4" />
                  {t('admin.setting.ai.moreModels')}
                  {!isLoadingGateway && pickerModels.length > 0 && (
                    <span className="text-xs text-muted-foreground">({pickerModels.length})</span>
                  )}
                </CommandItem>
              </Fragment>
            )}
          </Command>
        </PopoverContent>
      </Popover>

      {/* Gateway Model Picker Dialog */}
      <GatewayModelPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        models={pickerModels}
        isLoading={isLoadingGateway}
        selectedModelId={selectedModelIdForPicker}
        onSelectModel={handlePickerModelSelect}
        priceMode={isCloud ? 'credits' : 'none'}
      />
    </>
  );
}
