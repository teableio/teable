'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MessageSquareDot, Zap, Box, Loader2 } from '@teable/icons';
import { aiConfigVoSchema } from '@teable/openapi';
import type {
  IGatewayModel,
  IChatModelAbility,
  IImageModelAbility,
  LLMProvider,
  ISettingVo,
  IUpdateAiConfigRo,
} from '@teable/openapi';
import { Button, Form } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { AISetupWizard, useAISetupSteps, type LLMApiMode } from './AISetupWizard';
import { DefaultModelsStep } from './DefaultModelsStep';
import { GatewayModelsStep } from './GatewayModelsStep';
import { LLMApiConfigStep } from './LLMApiConfigStep';
import type { IModelTestResult } from './LlmproviderManage';
import { SetupStepCard } from './SetupStepCard';
import {
  generateModelKeyList,
  generateGatewayModelKeyList,
  normalizeLLMProviderModelConfigs,
  parseModelKey,
} from './utils';

const toCompareString = (value: unknown) => JSON.stringify(value ?? null);

function StepSaveBar({
  isSaving,
  disabled,
  onSave,
  label,
}: {
  isSaving: boolean;
  disabled?: boolean;
  onSave: () => void | Promise<void>;
  label: string;
}) {
  return (
    <div className="mt-4 flex items-center justify-end border-t bg-muted/30 px-4 py-3">
      <Button
        type="button"
        size="lg"
        className="min-w-28 shadow-sm"
        onClick={onSave}
        disabled={disabled || isSaving}
      >
        {isSaving && <Loader2 className="size-4 animate-spin" />}
        {label}
      </Button>
    </div>
  );
}

// Props to control whether to show pricing-related UI
interface IAIConfigFormWizardProps {
  aiConfig: ISettingVo['aiConfig'];
  onSaveAiConfig: (payload: IUpdateAiConfigRo) => Promise<unknown>;
  /** Whether to show pricing/billing related UI. Defaults to isCloud. */
  showPricing?: boolean;
}

export function AIConfigFormWizard({
  aiConfig,
  onSaveAiConfig,
  showPricing,
}: IAIConfigFormWizardProps) {
  const isCloud = useIsCloud();
  // showPricing defaults to isCloud if not explicitly provided
  const shouldShowPricing = showPricing ?? isCloud;
  const defaultValues = useMemo(
    () =>
      aiConfig ?? {
        llmProviders: [],
        gatewayModels: [],
      },
    [aiConfig]
  );

  const form = useForm<NonNullable<ISettingVo['aiConfig']>>({
    resolver: zodResolver(aiConfigVoSchema),
    defaultValues: defaultValues,
  });

  const llmProviders = form.watch('llmProviders') ?? [];
  const gatewayModels = form.watch('gatewayModels') ?? [];
  const chatModel = form.watch('chatModel');
  const draftAiConfig = form.watch();
  const providerModels = generateModelKeyList(llmProviders);
  const gatewayModelsList = generateGatewayModelKeyList(gatewayModels);

  const { reset } = form;
  const { t } = useTranslation(['common', 'space']);

  const [modelTestResults, setModelTestResults] = useState<Map<string, IModelTestResult>>(
    new Map()
  );
  const [testingProviders, setTestingProviders] = useState<Set<string>>(new Set());
  const [testingModels, setTestingModels] = useState<Set<string>>(new Set());
  const [savingSection, setSavingSection] = useState<IUpdateAiConfigRo['section'] | null>(null);
  const testProviderCallbackRef = useRef<((provider: LLMProvider) => void) | null>(null);
  const testModelCallbackRef = useRef<
    ((provider: LLMProvider, model: string, modelKey: string) => Promise<void>) | null
  >(null);

  // LLM API mode: gateway or custom
  // Auto-detect initial mode based on existing config
  const [llmApiMode, setLlmApiModeRaw] = useState<LLMApiMode>(() => {
    if (aiConfig?.aiGatewayApiKey) return 'gateway';
    if (llmProviders.length > 0) return 'custom';
    return 'gateway'; // Default to gateway
  });

  const setLlmApiMode = useCallback((mode: LLMApiMode) => {
    setLlmApiModeRaw(mode);
  }, []);

  const handleResetGateway = useCallback(() => {
    const current = form.getValues();
    const currentChatModel = current.chatModel;
    const hasGatewayChatModel = [currentChatModel?.lg, currentChatModel?.md, currentChatModel?.sm]
      .filter(Boolean)
      .some((modelKey) => modelKey?.startsWith('aiGateway@'));
    const clearedConfig: NonNullable<ISettingVo['aiConfig']> = {
      ...current,
      gatewayModels: [],
      aiGatewayApiKey: null,
      aiGatewayBaseUrl: null,
      chatModel: hasGatewayChatModel ? null : currentChatModel,
      attachmentTest: null,
      attachmentTransferMode: null,
    };
    form.reset(clearedConfig);
  }, [form]);

  // Current step state
  // Default collapsed on page load, user can expand steps manually.
  const [currentStep, setCurrentStep] = useState(-1);

  // Compute step completion status
  const { hasGatewayKey, isStep1Complete, isStep2Complete } = useAISetupSteps({
    aiConfig,
    gatewayModels: aiConfig?.gatewayModels ?? [],
    llmProviders: aiConfig?.llmProviders ?? [],
    llmApiMode,
  });

  // Models available for Step 3 Chat Model selection
  // Strictly comes from Step 2's "model pool"
  const availableModels = useMemo(() => {
    if (llmApiMode === 'gateway') {
      return gatewayModelsList;
    }
    return providerModels;
  }, [llmApiMode, gatewayModelsList, providerModels]);

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const normalizeAiConfig = useCallback((data: NonNullable<ISettingVo['aiConfig']>) => {
    return {
      ...data,
      llmProviders: data.llmProviders?.map(normalizeLLMProviderModelConfigs) ?? [],
    };
  }, []);

  const savedLlmApiConfig = useMemo(
    () => ({
      llmProviders: aiConfig?.llmProviders?.map(normalizeLLMProviderModelConfigs) ?? [],
      aiGatewayApiKey: aiConfig?.aiGatewayApiKey ?? null,
      aiGatewayBaseUrl: aiConfig?.aiGatewayBaseUrl ?? null,
      attachmentTest: aiConfig?.attachmentTest ?? null,
      attachmentTransferMode: aiConfig?.attachmentTransferMode ?? null,
    }),
    [aiConfig]
  );

  const draftLlmApiConfig = useMemo(() => {
    const normalized = normalizeAiConfig(draftAiConfig);
    return {
      llmProviders: normalized.llmProviders,
      aiGatewayApiKey: normalized.aiGatewayApiKey ?? null,
      aiGatewayBaseUrl: normalized.aiGatewayBaseUrl ?? null,
      attachmentTest: normalized.attachmentTest ?? null,
      attachmentTransferMode: normalized.attachmentTransferMode ?? null,
    };
  }, [draftAiConfig, normalizeAiConfig]);

  const isLlmApiDirty = useMemo(
    () => toCompareString(savedLlmApiConfig) !== toCompareString(draftLlmApiConfig),
    [draftLlmApiConfig, savedLlmApiConfig]
  );

  const isModelPoolDirty = useMemo(
    () => toCompareString(aiConfig?.gatewayModels ?? []) !== toCompareString(gatewayModels),
    [aiConfig?.gatewayModels, gatewayModels]
  );

  const isDefaultModelsDirty = useMemo(
    () =>
      toCompareString({
        chatModel: aiConfig?.chatModel ?? null,
        embeddingModel: aiConfig?.embeddingModel ?? null,
        translationModel: aiConfig?.translationModel ?? null,
      }) !==
      toCompareString({
        chatModel: draftAiConfig.chatModel ?? null,
        embeddingModel: draftAiConfig.embeddingModel ?? null,
        translationModel: draftAiConfig.translationModel ?? null,
      }),
    [
      aiConfig?.chatModel,
      aiConfig?.embeddingModel,
      aiConfig?.translationModel,
      draftAiConfig.chatModel,
      draftAiConfig.embeddingModel,
      draftAiConfig.translationModel,
    ]
  );

  const onSubmit = useCallback(
    async (data: NonNullable<ISettingVo['aiConfig']>) => {
      const normalizedData = normalizeAiConfig(data);
      try {
        setSavingSection('llmApi');
        await onSaveAiConfig({
          section: 'llmApi',
          patch: {
            llmProviders: normalizedData.llmProviders,
            aiGatewayApiKey: normalizedData.aiGatewayApiKey ?? null,
            aiGatewayBaseUrl: normalizedData.aiGatewayBaseUrl ?? null,
            attachmentTest: normalizedData.attachmentTest ?? null,
            attachmentTransferMode: normalizedData.attachmentTransferMode ?? null,
          },
        });
      } finally {
        setSavingSection(null);
      }
    },
    [normalizeAiConfig, onSaveAiConfig]
  );

  const updateProviders = useCallback(
    (providers: LLMProvider[]) => {
      const normalizedProviders = providers.map(normalizeLLMProviderModelConfigs);
      form.setValue('llmProviders', normalizedProviders);
      form.trigger('llmProviders');
    },
    [form]
  );

  const updateGatewayModels = useCallback(
    (models: IGatewayModel[]) => {
      form.setValue('gatewayModels', models);
    },
    [form]
  );

  const updateChatModel = useCallback(
    (chatModel: { lg?: string; md?: string; sm?: string }) => {
      form.setValue('chatModel', chatModel);
    },
    [form]
  );

  const onSaveTestResult = useCallback(
    (
      modelKey: string,
      ability: IChatModelAbility | undefined,
      imageAbility: IImageModelAbility | undefined
    ) => {
      const parsed = parseModelKey(modelKey);
      if (!parsed.type || !parsed.model || !parsed.name) return;

      const { type, model, name } = parsed;
      const currentProviders = form.getValues('llmProviders') ?? [];
      const providerIndex = currentProviders.findIndex((p) => p.type === type && p.name === name);

      if (providerIndex === -1) return;

      const provider = currentProviders[providerIndex];
      const updatedProvider = normalizeLLMProviderModelConfigs({
        ...provider,
        modelConfigs: {
          ...provider.modelConfigs,
          [model]: {
            ...provider.modelConfigs?.[model],
            ability,
            imageAbility,
            testedAt: Date.now(),
          },
        },
      });

      const newProviders = [...currentProviders];
      newProviders[providerIndex] = updatedProvider;

      form.setValue('llmProviders', newProviders);
    },
    [form]
  );

  const onToggleImageModel = useCallback(
    (modelKey: string, isImageModel: boolean) => {
      const parsed = parseModelKey(modelKey);
      if (!parsed.type || !parsed.model || !parsed.name) return;

      const { type, model, name } = parsed;
      const currentProviders = form.getValues('llmProviders') ?? [];
      const providerIndex = currentProviders.findIndex((p) => p.type === type && p.name === name);

      if (providerIndex === -1) return;

      const provider = currentProviders[providerIndex];
      const currentConfig = provider.modelConfigs?.[model];
      const updatedProvider = normalizeLLMProviderModelConfigs({
        ...provider,
        modelConfigs: {
          ...provider.modelConfigs,
          [model]: {
            ...currentConfig,
            isImageModel,
            ability: isImageModel ? undefined : provider.modelConfigs?.[model]?.ability,
          },
        },
      });

      const newProviders = [...currentProviders];
      newProviders[providerIndex] = updatedProvider;

      form.setValue('llmProviders', newProviders);
    },
    [form]
  );

  // Handler for updating gateway-related fields in aiConfig
  const updateAiConfig = useCallback(
    (updates: Partial<NonNullable<ISettingVo['aiConfig']>>) => {
      Object.entries(updates).forEach(([key, value]) => {
        form.setValue(key as keyof typeof updates, value);
      });
    },
    [form]
  );

  const saveLlmApi = useCallback(async () => {
    await onSubmit(form.getValues());
  }, [form, onSubmit]);

  const saveModelPool = useCallback(async () => {
    try {
      setSavingSection('modelPool');
      await onSaveAiConfig({
        section: 'modelPool',
        patch: { gatewayModels: form.getValues('gatewayModels') ?? [] },
      });
    } finally {
      setSavingSection(null);
    }
  }, [form, onSaveAiConfig]);

  const saveDefaultModels = useCallback(async () => {
    try {
      setSavingSection('defaultModels');
      await onSaveAiConfig({
        section: 'defaultModels',
        patch: {
          chatModel: form.getValues('chatModel') ?? null,
          embeddingModel: form.getValues('embeddingModel') ?? null,
          translationModel: form.getValues('translationModel') ?? null,
        },
      });
    } finally {
      setSavingSection(null);
    }
  }, [form, onSaveAiConfig]);

  // Unified wizard view for both Cloud and EE
  // The only difference is `shouldShowPricing` controls whether to display pricing UI
  return (
    <Form {...form}>
      <form onSubmit={(e) => e.preventDefault()}>
        <AISetupWizard>
          <div className="space-y-4">
            {/* Step 1: Configure LLM API (Gateway OR Custom Provider) */}
            <SetupStepCard
              icon={<Zap className="size-4" />}
              title={t('admin.setting.ai.wizard.step.llmApi')}
              description={t('admin.setting.ai.wizard.step.llmApiDesc')}
              isComplete={isStep1Complete}
              isExpanded={currentStep === 0}
              onToggle={() => setCurrentStep(currentStep === 0 ? -1 : 0)}
            >
              <LLMApiConfigStep
                mode={llmApiMode}
                onModeChange={setLlmApiMode}
                aiConfig={draftAiConfig}
                onAiConfigChange={updateAiConfig}
                onResetGateway={handleResetGateway}
                llmProviders={llmProviders}
                onProvidersChange={updateProviders}
                control={form.control}
                modelTestResults={modelTestResults}
                onModelTestResultsChange={setModelTestResults}
                testingProviders={testingProviders}
                onTestingProvidersChange={setTestingProviders}
                testingModels={testingModels}
                onTestingModelsChange={setTestingModels}
                onSaveTestResult={onSaveTestResult}
                onToggleImageModel={onToggleImageModel}
                testProviderCallbackRef={testProviderCallbackRef}
                testModelCallbackRef={testModelCallbackRef}
                onSave={saveLlmApi}
                isSaving={savingSection === 'llmApi'}
                isDirty={isLlmApiDirty}
                onComplete={() => setCurrentStep(1)}
                showPricing={shouldShowPricing}
              />
            </SetupStepCard>

            {/* Step 2: Configure Model Pool */}
            <SetupStepCard
              icon={<Box className="size-4" />}
              title={t('admin.setting.ai.wizard.step.modelPool')}
              description={t('admin.setting.ai.wizard.step.modelPoolDesc')}
              isComplete={isStep2Complete}
              isExpanded={currentStep === 1}
              onToggle={() => setCurrentStep(currentStep === 1 ? -1 : 1)}
              disabled={!isStep1Complete}
            >
              {llmApiMode === 'gateway' ? (
                <>
                  <GatewayModelsStep
                    gatewayModels={gatewayModels}
                    onChange={updateGatewayModels}
                    disabled={!hasGatewayKey}
                    apiKey={form.getValues().aiGatewayApiKey ?? undefined}
                    showPricing={shouldShowPricing}
                  />
                  {isModelPoolDirty && (
                    <StepSaveBar
                      isSaving={savingSection === 'modelPool'}
                      label={t('actions.save')}
                      onSave={async () => {
                        await saveModelPool();
                        setCurrentStep(2);
                      }}
                    />
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-500/10 dark:text-green-400">
                    <p>{t('admin.setting.ai.wizard.customModelsAutoImported')}</p>
                    <p className="mt-1 font-medium">
                      {t('admin.setting.ai.wizard.modelsCount', {
                        count: providerModels.length,
                      })}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {t('admin.setting.ai.wizard.customModelsHint')}
                  </p>
                </div>
              )}
            </SetupStepCard>

            {/* Step 3: Set Chat Model */}
            <SetupStepCard
              icon={<MessageSquareDot className="size-4" />}
              title={t('admin.setting.ai.wizard.step.chatModel')}
              description={t('admin.setting.ai.wizard.step.chatModelDesc')}
              isComplete={Boolean(aiConfig?.chatModel?.lg)}
              isExpanded={currentStep === 2}
              onToggle={() => setCurrentStep(currentStep === 2 ? -1 : 2)}
              disabled={!isStep2Complete}
            >
              <DefaultModelsStep
                chatModel={chatModel ?? undefined}
                models={availableModels}
                onChange={updateChatModel}
                disabled={!isStep2Complete}
              />
              {isDefaultModelsDirty && (
                <StepSaveBar
                  isSaving={savingSection === 'defaultModels'}
                  disabled={!chatModel?.lg || !isStep2Complete}
                  label={t('actions.save')}
                  onSave={saveDefaultModels}
                />
              )}
            </SetupStepCard>
          </div>
        </AISetupWizard>
      </form>
    </Form>
  );
}
