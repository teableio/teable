'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MessageSquareDot, Zap, Box } from '@teable/icons';
import { aiConfigVoSchema } from '@teable/openapi';
import type {
  IGatewayModel,
  IChatModelAbility,
  IImageModelAbility,
  LLMProvider,
  ISettingVo,
} from '@teable/openapi';
import { Form } from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { AIEnableCard } from './AIEnableCard';
import { AISetupWizard, useAISetupSteps, type LLMApiMode } from './AISetupWizard';
import { DefaultModelsStep } from './DefaultModelsStep';
import { GatewayModelsStep } from './GatewayModelsStep';
import { LLMApiConfigStep } from './LLMApiConfigStep';
import type { IModelTestResult } from './LlmproviderManage';
import { SetupStepCard } from './SetupStepCard';
import { generateModelKeyList, generateGatewayModelKeyList, parseModelKey } from './utils';

// Props to control whether to show pricing-related UI
interface IAIConfigFormWizardProps {
  aiConfig: ISettingVo['aiConfig'];
  setAiConfig: (data: NonNullable<ISettingVo['aiConfig']>) => void;
  /** Whether to show pricing/billing related UI. Defaults to isCloud. */
  showPricing?: boolean;
  /** Whether to show the enable card. Set to false when toggle is in parent. Defaults to true. */
  showEnableCard?: boolean;
}

export function AIConfigFormWizard({
  aiConfig,
  setAiConfig,
  showPricing,
  showEnableCard = true,
}: IAIConfigFormWizardProps) {
  const isCloud = useIsCloud();
  // showPricing defaults to isCloud if not explicitly provided
  const shouldShowPricing = showPricing ?? isCloud;
  const defaultValues = useMemo(
    () =>
      aiConfig ?? {
        enable: false,
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
  const aiEnabled = form.watch('enable') ?? false;
  const providerModels = generateModelKeyList(llmProviders);
  const gatewayModelsList = generateGatewayModelKeyList(gatewayModels);

  const { reset } = form;
  const { t } = useTranslation(['common', 'space']);

  const [modelTestResults, setModelTestResults] = useState<Map<string, IModelTestResult>>(
    new Map()
  );
  const [testingProviders, setTestingProviders] = useState<Set<string>>(new Set());
  const [testingModels, setTestingModels] = useState<Set<string>>(new Set());
  const testProviderCallbackRef = useRef<((provider: LLMProvider) => void) | null>(null);
  const testModelCallbackRef = useRef<
    ((provider: LLMProvider, model: string, modelKey: string) => Promise<void>) | null
  >(null);

  // LLM API mode: gateway or custom
  // Auto-detect initial mode based on existing config
  const [llmApiMode, setLlmApiMode] = useState<LLMApiMode>(() => {
    if (aiConfig?.aiGatewayApiKey) return 'gateway';
    if (llmProviders.length > 0) return 'custom';
    return 'gateway'; // Default to gateway
  });

  // Current step state
  // Default collapsed on page load, user can expand steps manually.
  const [currentStep, setCurrentStep] = useState(-1);

  // Compute step completion status
  const { hasGatewayKey, isStep1Complete, isStep2Complete } = useAISetupSteps({
    aiConfig,
    gatewayModels,
    llmProviders,
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

  const onSubmit = useCallback(
    (data: NonNullable<ISettingVo['aiConfig']>) => {
      console.log('onSubmit', data);
      setAiConfig(data);
      toast.success(t('admin.setting.ai.configUpdated'));
    },
    [setAiConfig, t]
  );

  const updateProviders = useCallback(
    (providers: LLMProvider[]) => {
      form.setValue('llmProviders', providers);
      form.trigger('llmProviders');
      onSubmit(form.getValues());
    },
    [form, onSubmit]
  );

  const updateGatewayModels = useCallback(
    (models: IGatewayModel[]) => {
      form.setValue('gatewayModels', models);
      onSubmit(form.getValues());
    },
    [form, onSubmit]
  );

  const updateChatModel = useCallback(
    (chatModel: { lg?: string; md?: string; sm?: string }) => {
      form.setValue('chatModel', chatModel);
      // Auto-enable AI when chat model is configured
      const shouldAutoEnable = chatModel.lg && !form.getValues('enable');
      if (shouldAutoEnable) {
        form.setValue('enable', true);
      }
      // Get current values and ensure enable is true if auto-enabled
      const currentValues = form.getValues();
      onSubmit({
        ...currentValues,
        enable: shouldAutoEnable ? true : currentValues.enable,
      });
    },
    [form, onSubmit]
  );

  const updateEnabled = useCallback(
    (enabled: boolean) => {
      form.setValue('enable', enabled);
      onSubmit(form.getValues());
    },
    [form, onSubmit]
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
      const updatedProvider = {
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
      };

      const newProviders = [...currentProviders];
      newProviders[providerIndex] = updatedProvider;

      form.setValue('llmProviders', newProviders);
      setAiConfig(form.getValues());
    },
    [form, setAiConfig]
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
      const updatedProvider = {
        ...provider,
        modelConfigs: {
          ...provider.modelConfigs,
          [model]: {
            ...provider.modelConfigs?.[model],
            isImageModel,
            ability: isImageModel ? undefined : provider.modelConfigs?.[model]?.ability,
            imageAbility: isImageModel ? provider.modelConfigs?.[model]?.imageAbility : undefined,
          },
        },
      };

      const newProviders = [...currentProviders];
      newProviders[providerIndex] = updatedProvider;

      form.setValue('llmProviders', newProviders);
      setAiConfig(form.getValues());
    },
    [form, setAiConfig]
  );

  // Handler for updating gateway-related fields in aiConfig
  const updateAiConfig = useCallback(
    (updates: Partial<NonNullable<ISettingVo['aiConfig']>>) => {
      const currentValues = form.getValues();
      const updatedConfig = { ...currentValues, ...updates };
      // Update form values
      Object.entries(updates).forEach(([key, value]) => {
        form.setValue(key as keyof typeof updates, value);
      });
      // Save to backend
      setAiConfig(updatedConfig);
    },
    [form, setAiConfig]
  );

  // Unified wizard view for both Cloud and EE
  // The only difference is `shouldShowPricing` controls whether to display pricing UI
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)}>
        <AISetupWizard>
          <div className="space-y-4">
            {/* AI Enable Toggle - Only visible when showEnableCard is true */}
            {showEnableCard && (
              <AIEnableCard
                enabled={aiEnabled}
                onEnabledChange={updateEnabled}
                hasGatewayKey={llmApiMode === 'gateway' ? hasGatewayKey : true}
                hasModels={isStep2Complete}
                hasChatModel={Boolean(chatModel?.lg)}
                isCloud={isCloud}
              />
            )}

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
                aiConfig={form.getValues()}
                onAiConfigChange={updateAiConfig}
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
                <GatewayModelsStep
                  gatewayModels={gatewayModels}
                  onChange={updateGatewayModels}
                  disabled={!hasGatewayKey}
                  apiKey={form.getValues().aiGatewayApiKey}
                  showPricing={shouldShowPricing}
                />
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
              isComplete={Boolean(chatModel?.lg)}
              isExpanded={currentStep === 2}
              onToggle={() => setCurrentStep(currentStep === 2 ? -1 : 2)}
              disabled={!isStep2Complete}
            >
              <DefaultModelsStep
                chatModel={chatModel}
                models={availableModels}
                onChange={updateChatModel}
                disabled={!isStep2Complete}
              />
            </SetupStepCard>
          </div>
        </AISetupWizard>
      </form>
    </Form>
  );
}
