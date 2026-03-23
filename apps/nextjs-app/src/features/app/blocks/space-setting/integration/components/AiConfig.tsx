import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { testIntegrationLLM, aiConfigVoSchema, getPublicSetting } from '@teable/openapi';
import type {
  IAIIntegrationConfig,
  IChatModelAbility,
  IImageModelAbility,
  ITestLLMRo,
  LLMProvider,
} from '@teable/openapi';
import { Form, toast } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { AIControlCard } from '../../../admin/setting/components/ai-config/AIControlCard';
import { AIModelPreferencesCard } from '../../../admin/setting/components/ai-config/AIModelPreferencesCard';
import type { IModelOption } from '../../../admin/setting/components/ai-config/AiModelSelect';
import { AIProviderCard } from '../../../admin/setting/components/ai-config/AIProviderCard';
import { BatchTestModels } from '../../../admin/setting/components/ai-config/BatchTestModels';
import type { IModelTestResult } from '../../../admin/setting/components/ai-config/LlmproviderManage';
import {
  generateModelKeyList,
  generateGatewayModelKeyList,
  parseModelKey,
} from '../../../admin/setting/components/ai-config/utils';

interface IAIConfigProps {
  config: IAIIntegrationConfig;
  onChange: (value: IAIIntegrationConfig) => void;
}

export const AIConfig = (props: IAIConfigProps) => {
  const { config, onChange } = props;
  const router = useRouter();
  const spaceId = router.query.spaceId as string;

  const defaultValues = useMemo(
    () =>
      config ?? {
        enable: false,
        llmProviders: [],
      },
    [config]
  );

  const form = useForm<IAIIntegrationConfig>({
    resolver: zodResolver(aiConfigVoSchema),
    defaultValues: defaultValues,
  });
  const llmProviders = form.watch('llmProviders') ?? [];
  const { reset } = form;
  const { t } = useTranslation('common');

  // Get public setting for instance AI config (includes gateway models)
  const { data: setting } = useQuery({
    queryKey: ['public-setting'],
    queryFn: () => getPublicSetting().then(({ data }) => data),
  });

  // Generate combined model list: space models, gateway models, instance models
  const models = useMemo((): IModelOption[] => {
    const providerModels = generateModelKeyList(llmProviders);

    // Get gateway models from public settings (enabled models only)
    const publicGatewayModels = setting?.aiConfig?.gatewayModels || [];
    const gatewayModels = generateGatewayModelKeyList(publicGatewayModels);

    // Get instance-level providers from public settings
    const instanceProviders = setting?.aiConfig?.llmProviders || [];
    const instanceModelsFromSetting = generateModelKeyList(instanceProviders);

    // Separate space and instance models from space integration
    const spaceModels = providerModels.filter((m) => !m.isInstance);

    // Combine in order: space models, gateway models, instance models
    return [...spaceModels, ...gatewayModels, ...instanceModelsFromSetting];
  }, [llmProviders, setting?.aiConfig?.gatewayModels, setting?.aiConfig?.llmProviders]);

  const defaultModelPlaceholder = useMemo(() => {
    const defaultModelKey = setting?.aiConfig?.chatModel?.lg;
    if (!defaultModelKey) return t('admin.setting.ai.selectModel');
    const defaultModel = models.find(
      (m) => m.modelKey.toLowerCase() === defaultModelKey.toLowerCase()
    );
    const name = defaultModel?.label || parseModelKey(defaultModelKey).model;
    return name ? t('admin.setting.ai.defaultModel', { name }) : t('admin.setting.ai.selectModel');
  }, [setting?.aiConfig?.chatModel?.lg, models, t]);

  // State for batch testing models
  const [modelTestResults, setModelTestResults] = useState<Map<string, IModelTestResult>>(
    new Map()
  );
  const [testingProviders, setTestingProviders] = useState<Set<string>>(new Set());
  const [testingModels, setTestingModels] = useState<Set<string>>(new Set());
  const testProviderCallbackRef = useRef<((provider: LLMProvider) => void) | null>(null);
  const testModelCallbackRef = useRef<
    ((provider: LLMProvider, model: string, modelKey: string) => Promise<void>) | null
  >(null);

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const onSubmit = useCallback(
    async (data: IAIIntegrationConfig) => {
      onChange(data);
      toast({
        title: t('admin.setting.ai.configUpdated'),
      });
    },
    [onChange, t]
  );

  const onProvidersUpdate = (providers: LLMProvider[]) => {
    form.setValue('llmProviders', providers);
    form.trigger('llmProviders');
    onSubmit(form.getValues());
  };

  const onTest = async (data: ITestLLMRo) => testIntegrationLLM(spaceId, data);

  // Save test result to provider config (silent save without toast)
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
      // Silent save without toast
      onChange(form.getValues());
    },
    [form, onChange]
  );

  // Toggle image model flag
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
            // Clear previous test results when toggling
            ability: isImageModel ? undefined : provider.modelConfigs?.[model]?.ability,
            imageAbility: isImageModel ? provider.modelConfigs?.[model]?.imageAbility : undefined,
          },
        },
      };

      const newProviders = [...currentProviders];
      newProviders[providerIndex] = updatedProvider;

      form.setValue('llmProviders', newProviders);
      onChange(form.getValues());
    },
    [form, onChange]
  );

  const instanceAIDisableActions = setting?.aiConfig?.capabilities?.disableActions || [];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
        <AIControlCard
          disableActions={config?.capabilities?.disableActions || instanceAIDisableActions}
          instanceDisableActions={instanceAIDisableActions}
          onChange={(value: { disableActions: string[] }) => {
            form.setValue('capabilities', value);
            onSubmit(form.getValues());
          }}
        />
        <AIProviderCard
          control={form.control}
          onChange={onProvidersUpdate}
          onTest={onTest}
          modelTestResults={modelTestResults}
          onToggleImageModel={onToggleImageModel}
          onTestProvider={(provider) => testProviderCallbackRef.current?.(provider)}
          onTestModel={(provider, model, modelKey) =>
            testModelCallbackRef.current?.(provider, model, modelKey) ?? Promise.resolve()
          }
          testingProviders={testingProviders}
          testingModels={testingModels}
          hideModelRates
          onSaveTestResult={onSaveTestResult}
          title={t('admin.setting.ai.provider')}
          headerActions={
            <BatchTestModels
              providers={llmProviders}
              disabled={!llmProviders?.length}
              onTest={onTest}
              onResultsChange={setModelTestResults}
              onSaveResult={onSaveTestResult}
              onTestingProvidersChange={setTestingProviders}
              onTestingModelsChange={setTestingModels}
              onTestProvider={(callback) => {
                testProviderCallbackRef.current = callback;
              }}
              onTestModel={(callback) => {
                testModelCallbackRef.current = callback;
              }}
            />
          }
        />
        <AIModelPreferencesCard
          control={form.control}
          models={models}
          onChange={() => onSubmit(form.getValues())}
          needGroup={true}
          hideEmbeddingModel
          title={t('admin.setting.ai.modelPreferences')}
          modelPlaceholder={defaultModelPlaceholder}
          onReset={() => {
            form.setValue('chatModel', null);
            onSubmit(form.getValues());
          }}
        />
      </form>
    </Form>
  );
};
