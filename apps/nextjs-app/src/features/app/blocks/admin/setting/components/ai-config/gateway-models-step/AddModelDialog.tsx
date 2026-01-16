'use client';

import { Plus, AlertCircle, CheckCircle2 } from '@teable/icons';
import type { IGatewayModel } from '@teable/openapi';
import {
  Button,
  Input,
  cn,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Label,
} from '@teable/ui-lib/shadcn';
import type { TFunction } from 'next-i18next';
import { ModelSearchPopover } from './ModelSearchPopover';
import { PricingSection } from './PricingSection';
import type { IGatewayModelAPI, ITestState } from './types';

interface IAddModelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  newModel: Partial<IGatewayModel>;
  onNewModelChange: (model: Partial<IGatewayModel>) => void;
  // Search popover props
  modelSearchOpen: boolean;
  onModelSearchOpenChange: (open: boolean) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  isModelIdValid: boolean;
  isLoadingModels: boolean;
  modelsLoadError: string | null;
  filteredModels: IGatewayModelAPI[];
  gatewayModels: IGatewayModel[];
  availableModelsCount: number;
  onSelectModel: (modelId: string) => void;
  onRetry: () => void;
  // Pricing props
  showPricing: boolean;
  pricingExpanded: boolean;
  onPricingExpandedChange: (expanded: boolean) => void;
  onPricingChange: (
    field: 'input' | 'output' | 'inputCacheRead' | 'inputCacheWrite' | 'image' | 'webSearch',
    value: string
  ) => void;
  // Test state
  testState: ITestState;
  // Actions
  onAddModel: () => void;
  t: TFunction;
}

export function AddModelDialog({
  open,
  onOpenChange,
  newModel,
  onNewModelChange,
  modelSearchOpen,
  onModelSearchOpenChange,
  searchQuery,
  onSearchQueryChange,
  isModelIdValid,
  isLoadingModels,
  modelsLoadError,
  filteredModels,
  gatewayModels,
  availableModelsCount,
  onSelectModel,
  onRetry,
  showPricing,
  pricingExpanded,
  onPricingExpandedChange,
  onPricingChange,
  testState,
  onAddModel,
  t,
}: IAddModelDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('admin.setting.ai.addGatewayModel')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Model ID with search */}
          <div>
            <Label>{t('admin.setting.ai.modelId')}</Label>
            <ModelSearchPopover
              open={modelSearchOpen}
              onOpenChange={onModelSearchOpenChange}
              selectedModelId={newModel.id || ''}
              isModelIdValid={isModelIdValid}
              isLoadingModels={isLoadingModels}
              modelsLoadError={modelsLoadError}
              filteredModels={filteredModels}
              gatewayModels={gatewayModels}
              searchQuery={searchQuery}
              onSearchQueryChange={onSearchQueryChange}
              onSelectModel={onSelectModel}
              onRetry={onRetry}
              t={t}
            />
            {!isModelIdValid && availableModelsCount > 0 && (
              <p className="mt-1 text-xs text-amber-600">{t('admin.setting.ai.modelNotFound')}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {t('admin.setting.ai.modelIdHint')}
            </p>
          </div>

          <div>
            <Label>{t('admin.setting.ai.displayLabel')}</Label>
            <Input
              value={newModel.label}
              onChange={(e) => onNewModelChange({ ...newModel, label: e.target.value })}
              placeholder="Model Display Name"
              className="mt-1"
            />
          </div>

          {/* Note: isImageModel is auto-detected from API type and tags */}

          {/* Pricing Section - USD per token (only show in Cloud) */}
          {showPricing && (
            <PricingSection
              expanded={pricingExpanded}
              onExpandedChange={onPricingExpandedChange}
              pricing={newModel.pricing}
              modelType={newModel.modelType}
              onPricingChange={onPricingChange}
            />
          )}
        </div>

        {/* Test Result */}
        {testState.result && (
          <div
            className={cn(
              'flex items-center gap-2 rounded-lg p-3 text-sm',
              testState.result === 'success'
                ? 'bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-300'
                : 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300'
            )}
          >
            {testState.result === 'success' ? (
              <CheckCircle2 className="size-4" />
            ) : (
              <AlertCircle className="size-4" />
            )}
            {testState.message}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <div className="flex-1" />
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={onAddModel} disabled={!newModel.id || !newModel.label}>
            <Plus className="mr-1 size-4" />
            {t('admin.setting.ai.addModel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
