'use client';

import { Search, Loader2 } from '@teable/icons';
import type { IGatewayModel } from '@teable/openapi';
import {
  Button,
  Badge,
  cn,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@teable/ui-lib/shadcn';
import type { TFunction } from 'next-i18next';
import { useEffect, useRef } from 'react';
import { GATEWAY_PROVIDER_ICONS } from '../constant';
import type { IGatewayModelAPI } from './types';
import { formatUsdPriceShort, detectIsImageModel, getPricingFromApiModel } from './utils';

interface IModelSearchPopoverProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedModelId: string;
  isModelIdValid: boolean;
  isLoadingModels: boolean;
  modelsLoadError: string | null;
  filteredModels: IGatewayModelAPI[];
  gatewayModels: IGatewayModel[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onSelectModel: (modelId: string) => void;
  onRetry: () => void;
  t: TFunction;
}

export function ModelSearchPopover({
  open,
  onOpenChange,
  selectedModelId,
  isModelIdValid,
  isLoadingModels,
  modelsLoadError,
  filteredModels,
  gatewayModels,
  searchQuery,
  onSearchQueryChange,
  onSelectModel,
  onRetry,
  t,
}: IModelSearchPopoverProps) {
  const commandListRef = useRef<HTMLDivElement>(null);

  // Scroll to top when search query changes
  useEffect(() => {
    if (commandListRef.current) {
      commandListRef.current.scrollTop = 0;
    }
  }, [searchQuery]);

  return (
    <Popover open={open} onOpenChange={onOpenChange} modal>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            'mt-1 w-full justify-between font-normal',
            !selectedModelId && 'text-muted-foreground',
            !isModelIdValid && 'border-amber-500'
          )}
        >
          {selectedModelId || t('admin.setting.ai.searchModel')}
          {isLoadingModels ? (
            <Loader2 className="ml-2 size-4 shrink-0 animate-spin opacity-50" />
          ) : (
            <Search className="ml-2 size-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={t('admin.setting.ai.searchModelPlaceholder')}
            value={searchQuery}
            onValueChange={onSearchQueryChange}
          />
          <CommandList ref={commandListRef} className="max-h-[300px]">
            {isLoadingModels ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : modelsLoadError ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                <p>{modelsLoadError}</p>
                <Button size="sm" variant="ghost" className="mt-2" onClick={onRetry}>
                  Retry
                </Button>
              </div>
            ) : filteredModels.length === 0 ? (
              <CommandEmpty>
                {searchQuery ? (
                  <div className="space-y-2">
                    <p>{t('admin.setting.ai.noMatchingModels')}</p>
                    <Button size="sm" variant="outline" onClick={() => onSelectModel(searchQuery)}>
                      {t('admin.setting.ai.useCustomId', { id: searchQuery })}
                    </Button>
                  </div>
                ) : (
                  t('admin.setting.ai.typeToSearch')
                )}
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredModels.map((model) => {
                  const isAlreadyAdded = gatewayModels.some((m) => m.id === model.id);
                  const pricing = getPricingFromApiModel(model);
                  const isImage = detectIsImageModel(model.id, model);
                  const ModelIcon = model.ownedBy
                    ? GATEWAY_PROVIDER_ICONS[model.ownedBy as keyof typeof GATEWAY_PROVIDER_ICONS]
                    : undefined;
                  return (
                    <CommandItem
                      key={model.id}
                      value={model.id}
                      onSelect={() => onSelectModel(model.id)}
                      disabled={isAlreadyAdded}
                      className={cn(isAlreadyAdded && 'opacity-50')}
                    >
                      <div className="flex flex-1 items-center justify-between">
                        <div className="flex items-center gap-2">
                          {ModelIcon && <ModelIcon className="size-5 shrink-0" />}
                          <div className="flex min-w-0 flex-1 flex-col gap-1">
                            <div className="flex items-center gap-2">
                              <code className="text-xs">{model.id}</code>
                              {isImage && (
                                <Badge variant="secondary" className="h-5 border p-1.5 text-[10px]">
                                  Image
                                </Badge>
                              )}
                            </div>
                            {model.name && (
                              <div className="text-xs text-muted-foreground">{model.name}</div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {pricing && (pricing.input || pricing.output) && (
                            <Badge variant="outline" className="text-[10px]">
                              {formatUsdPriceShort(pricing.input)}/
                              {formatUsdPriceShort(pricing.output)}
                            </Badge>
                          )}
                          {isAlreadyAdded && (
                            <Badge variant="secondary" className="text-[10px]">
                              Added
                            </Badge>
                          )}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
