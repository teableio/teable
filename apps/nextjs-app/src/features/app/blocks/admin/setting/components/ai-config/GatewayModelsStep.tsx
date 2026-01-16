'use client';

import type { IGatewayModel } from '@teable/openapi';
import { Label } from '@teable/ui-lib/shadcn';
import Fuse from 'fuse.js';
import { useTranslation } from 'next-i18next';
import { useState, useCallback, useEffect, useMemo } from 'react';
import { AddModelDialog } from './gateway-models-step/AddModelDialog';
import { ModelCard } from './gateway-models-step/ModelCard';
import { QuickAddButtons } from './gateway-models-step/QuickAddButtons';
import type {
  IGatewayModelAPI,
  IGatewayModelsStepProps,
  ITestState,
} from './gateway-models-step/types';
import { RECOMMENDED_MODEL_IDS } from './gateway-models-step/types';
import {
  generateLabelFromId,
  getPricingFromApiModel,
  detectIsImageModel,
  detectCapabilitiesFromTags,
} from './gateway-models-step/utils';

export function GatewayModelsStep({
  gatewayModels,
  onChange,
  disabled,
  apiKey,
  showPricing = true,
}: IGatewayModelsStepProps) {
  const { t } = useTranslation('common');
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newModel, setNewModel] = useState<Partial<IGatewayModel>>({
    id: '',
    label: '',
    enabled: true,
    capabilities: {},
    rates: {},
  });
  // Local state for expanding pricing input section in the form
  const [pricingExpanded, setPricingExpanded] = useState(false);
  const [testState, setTestState] = useState<ITestState>({ testing: false });

  // Model search state
  const [availableModels, setAvailableModels] = useState<IGatewayModelAPI[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelSearchOpen, setModelSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [modelsLoadError, setModelsLoadError] = useState<string | null>(null);

  // Fetch available models from backend API (cached)
  const fetchModels = useCallback(async () => {
    if (!apiKey) return;

    setIsLoadingModels(true);
    setModelsLoadError(null);

    try {
      // Use backend API which has in-memory caching
      const response = await fetch('/api/admin/setting/gateway-models');

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status}`);
      }

      const data = await response.json();
      const models: IGatewayModelAPI[] = data.models || [];
      setAvailableModels(models);
    } catch (error) {
      console.error('Failed to fetch gateway models:', error);
      setModelsLoadError(error instanceof Error ? error.message : 'Failed to fetch models');
    } finally {
      setIsLoadingModels(false);
    }
  }, [apiKey]);

  // Load models on component mount (for quick add buttons) and when dialog opens
  useEffect(() => {
    if (apiKey && availableModels.length === 0) {
      fetchModels();
    }
  }, [apiKey, availableModels.length, fetchModels]);

  // Sort models by created timestamp (newest first)
  const sortedModels = useMemo(() => {
    return [...availableModels].sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  }, [availableModels]);

  // Fuse.js instance for fuzzy search on name, id, and description
  const fuse = useMemo(() => {
    return new Fuse(sortedModels, {
      keys: [
        { name: 'name', weight: 2 },
        { name: 'id', weight: 1.5 },
        { name: 'description', weight: 1 },
      ],
      threshold: 0.4,
      includeScore: true,
      ignoreLocation: true,
    });
  }, [sortedModels]);

  // Filter models based on search query using Fuse.js
  const filteredModels = useMemo(() => {
    if (!searchQuery) return sortedModels.slice(0, 50);
    const results = fuse.search(searchQuery);
    return results.map((r) => r.item).slice(0, 50);
  }, [sortedModels, searchQuery, fuse]);

  // Find API model by ID
  const findApiModel = useCallback(
    (modelId: string): IGatewayModelAPI | undefined => {
      return availableModels.find((m) => m.id === modelId);
    },
    [availableModels]
  );

  const handleSelectModel = useCallback(
    (modelId: string) => {
      const apiModel = findApiModel(modelId);
      const suggestedLabel = generateLabelFromId(modelId, apiModel?.name);
      const apiPricing = getPricingFromApiModel(apiModel);
      const isImageModel = detectIsImageModel(modelId, apiModel);
      const capabilities = detectCapabilitiesFromTags(apiModel?.tags);

      setNewModel((prev) => ({
        ...prev,
        id: modelId,
        label: suggestedLabel,
        pricing: apiPricing || prev.pricing,
        isImageModel,
        capabilities: capabilities || prev.capabilities,
        // Store API metadata for later use (e.g., provider detection, capability checks)
        ownedBy: apiModel?.ownedBy,
        modelType: apiModel?.type,
        tags: apiModel?.tags,
        contextWindow: apiModel?.contextWindow,
        maxTokens: apiModel?.maxTokens,
        description: apiModel?.description,
      }));
      setModelSearchOpen(false);
      setSearchQuery('');
      setTestState({ testing: false }); // Reset test state on model change

      // Show pricing section if we have pricing data
      if (apiPricing) {
        setPricingExpanded(true);
      }
    },
    [findApiModel]
  );

  // Filter recommended models: only show those not already added and found in API
  const availableRecommendedIds = useMemo(
    () =>
      RECOMMENDED_MODEL_IDS.filter(
        (id) =>
          !gatewayModels.some((m) => m.id === id) &&
          (availableModels.length === 0 || availableModels.some((m) => m.id === id))
      ),
    [gatewayModels, availableModels]
  );

  const handleAddModel = useCallback(() => {
    if (!newModel.id || !newModel.label) return;

    // Auto-detect capabilities if not manually set
    const capabilities =
      newModel.capabilities && Object.keys(newModel.capabilities).length > 0
        ? newModel.capabilities
        : detectCapabilitiesFromTags(newModel.tags);

    const model: IGatewayModel = {
      id: newModel.id,
      label: newModel.label,
      enabled: newModel.enabled ?? true,
      capabilities,
      isImageModel: newModel.isImageModel,
      pricing: newModel.pricing,
      // API metadata
      ownedBy: newModel.ownedBy,
      modelType: newModel.modelType,
      tags: newModel.tags,
      contextWindow: newModel.contextWindow,
      maxTokens: newModel.maxTokens,
      description: newModel.description,
    };

    onChange([...gatewayModels, model]);
    setNewModel({ id: '', label: '', enabled: true, capabilities: {}, pricing: {} });
    setPricingExpanded(false);
    setTestState({ testing: false });
    setIsAddDialogOpen(false);
  }, [newModel, gatewayModels, onChange]);

  const handleQuickAdd = useCallback(
    (modelId: string) => {
      // Get all model info from API
      const apiModel = findApiModel(modelId);
      const apiPricing = getPricingFromApiModel(apiModel);
      const isImageModel =
        apiModel?.type === 'image' || apiModel?.tags?.includes('image-generation');
      const capabilities = detectCapabilitiesFromTags(apiModel?.tags);

      const model: IGatewayModel = {
        id: modelId,
        label: apiModel?.name || generateLabelFromId(modelId),
        enabled: true,
        capabilities,
        isImageModel,
        pricing: apiPricing,
        // API metadata
        ownedBy: apiModel?.ownedBy,
        modelType: apiModel?.type,
        tags: apiModel?.tags,
        contextWindow: apiModel?.contextWindow,
        maxTokens: apiModel?.maxTokens,
        description: apiModel?.description,
      };
      onChange([...gatewayModels, model]);
    },
    [gatewayModels, onChange, findApiModel]
  );

  const handleRemoveModel = useCallback(
    (modelId: string) => {
      onChange(gatewayModels.filter((m) => m.id !== modelId));
    },
    [gatewayModels, onChange]
  );

  const handleToggleEnabled = useCallback(
    (modelId: string, enabled: boolean) => {
      onChange(gatewayModels.map((m) => (m.id === modelId ? { ...m, enabled } : m)));
    },
    [gatewayModels, onChange]
  );

  // Check if selected model ID is valid (exists in API)
  const isModelIdValid = useMemo(() => {
    if (!newModel.id) return true;
    if (availableModels.length === 0) return true;
    return availableModels.some((m) => m.id === newModel.id);
  }, [newModel.id, availableModels]);

  // Update pricing in newModel (USD format - string values)
  const updatePricing = useCallback(
    (
      field: 'input' | 'output' | 'inputCacheRead' | 'inputCacheWrite' | 'image' | 'webSearch',
      value: string
    ) => {
      setNewModel((prev) => ({
        ...prev,
        pricing: {
          ...prev.pricing,
          [field]: value || undefined,
        },
      }));
    },
    []
  );

  if (disabled) {
    return (
      <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-center">
        <p className="text-sm text-muted-foreground">
          {t('admin.setting.ai.wizard.completeStep1First')}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quick Add Buttons */}
      <QuickAddButtons
        availableRecommendedIds={availableRecommendedIds}
        isLoadingModels={isLoadingModels}
        findApiModel={findApiModel}
        onQuickAdd={handleQuickAdd}
        onOpenDialog={() => setIsAddDialogOpen(true)}
        showPricing={showPricing}
        t={t}
      />

      {/* Model List */}
      {gatewayModels.length > 0 ? (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">
            {t('admin.setting.ai.wizard.enabledModels')} (
            {gatewayModels.filter((m) => m.enabled).length})
          </Label>
          <div className="space-y-2">
            {gatewayModels.map((model) => (
              <ModelCard
                key={model.id}
                model={model}
                showPricing={showPricing}
                onToggleEnabled={handleToggleEnabled}
                onRemove={handleRemoveModel}
              />
            ))}
          </div>
        </div>
      ) : (
        availableRecommendedIds.length === 0 && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">{t('admin.setting.ai.noGatewayModels')}</p>
          </div>
        )
      )}

      {/* Add Model Dialog */}
      <AddModelDialog
        open={isAddDialogOpen}
        onOpenChange={setIsAddDialogOpen}
        newModel={newModel}
        onNewModelChange={setNewModel}
        modelSearchOpen={modelSearchOpen}
        onModelSearchOpenChange={setModelSearchOpen}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        isModelIdValid={isModelIdValid}
        isLoadingModels={isLoadingModels}
        modelsLoadError={modelsLoadError}
        filteredModels={filteredModels}
        gatewayModels={gatewayModels}
        availableModelsCount={availableModels.length}
        onSelectModel={handleSelectModel}
        onRetry={fetchModels}
        showPricing={showPricing}
        pricingExpanded={pricingExpanded}
        onPricingExpandedChange={setPricingExpanded}
        onPricingChange={updatePricing}
        testState={testState}
        onAddModel={handleAddModel}
        t={t}
      />
    </div>
  );
}
