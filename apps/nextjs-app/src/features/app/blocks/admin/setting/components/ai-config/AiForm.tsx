import { zodResolver } from '@hookform/resolvers/zod';
import type { IAIIntegrationConfig } from '@teable/openapi';
import type {
  IChatModelAbility,
  IImageModelAbility,
  LLMProvider,
} from '@teable/openapi/src/admin/setting';
import { aiConfigVoSchema, chatModelAbilityType, testLLM } from '@teable/openapi/src/admin/setting';
import type { ISettingVo } from '@teable/openapi/src/admin/setting/get';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  Switch,
  toast,
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { AIControlCard } from './AIControlCard';
import { AIModelPreferencesCard } from './AIModelPreferencesCard';
import { AIProviderCard } from './AIProviderCard';
import { BatchTestModels } from './BatchTestModels';
import { FetchPricing } from './FetchPricing';
import type { IModelTestResult } from './LlmproviderManage';
import { generateModelKeyList, parseModelKey } from './utils';

export function AIConfigForm({
  aiConfig,
  setAiConfig,
}: {
  aiConfig: ISettingVo['aiConfig'];
  setAiConfig: (data: NonNullable<ISettingVo['aiConfig']>) => void;
}) {
  const defaultValues = useMemo(
    () =>
      aiConfig ?? {
        enable: false,
        llmProviders: [],
      },
    [aiConfig]
  );

  const form = useForm<NonNullable<ISettingVo['aiConfig']>>({
    resolver: zodResolver(aiConfigVoSchema),
    defaultValues: defaultValues,
  });
  const llmProviders = form.watch('llmProviders') ?? [];
  const enable = form.watch('enable');
  const models = generateModelKeyList(llmProviders);
  const { reset } = form;
  const { t } = useTranslation(['common', 'space']);
  const isCloud = useIsCloud();
  const [modelTestResults, setModelTestResults] = useState<Map<string, IModelTestResult>>(
    new Map()
  );
  const [testingProviders, setTestingProviders] = useState<Set<string>>(new Set());
  const testProviderCallbackRef = useRef<((provider: LLMProvider) => void) | null>(null);

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const onSubmit = useCallback(
    (data: NonNullable<ISettingVo['aiConfig']>) => {
      setAiConfig(data);
      toast({
        title: t('admin.setting.ai.configUpdated'),
      });
    },
    [setAiConfig, t]
  );

  function updateProviders(providers: LLMProvider[]) {
    form.setValue('llmProviders', providers);
    form.trigger('llmProviders');
    onSubmit(form.getValues());
  }

  // Save test results to modelConfigs and persist
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
      setAiConfig(form.getValues());
    },
    [form, setAiConfig]
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
      setAiConfig(form.getValues());
    },
    [form, setAiConfig]
  );

  const onTest = async (data: Required<LLMProvider>) => {
    // Only pass required fields, exclude modelConfigs
    const { type, name, apiKey, baseUrl, models } = data;
    return testLLM({ type, name, apiKey, baseUrl, models });
  };

  const enableAi = form.watch('enable');

  const switchEnable = useMemo(() => {
    if (enableAi) {
      return false;
    }
    if (!aiConfig?.chatModel?.lg && enableAi) {
      return false;
    }
    return (
      !aiConfig?.chatModel?.lg ||
      !models.some((model) => model.modelKey === aiConfig?.chatModel?.lg)
    );
  }, [aiConfig?.chatModel?.lg, enableAi, models]);

  const onTestChatModelAbility = async (chatModel: IAIIntegrationConfig['chatModel']) => {
    const testModelKey = chatModel?.lg;
    if (!testModelKey) {
      return;
    }
    const testModel = parseModelKey(testModelKey);
    const testLLMIndex = llmProviders.findIndex(
      (provider) =>
        provider.type === testModel.type &&
        provider.models.includes(testModel.model) &&
        provider.name === testModel.name
    );
    const testLLMProvider = llmProviders[testLLMIndex] as Required<LLMProvider>;
    if (!testLLMProvider) {
      return;
    }
    // Only pass required fields, exclude modelConfigs
    const { type, name, apiKey, baseUrl, models } = testLLMProvider;
    return testLLM({
      type,
      name,
      apiKey,
      baseUrl,
      models,
      modelKey: testModelKey,
      ability: chatModelAbilityType.options,
    }).then((res) => {
      if (res.success) {
        return res.ability;
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <h2 className="mb-4 text-lg font-medium">{t('admin.setting.ai.aiAbilitySettings')}</h2>
        <AIControlCard
          disableActions={aiConfig?.capabilities?.disableActions || []}
          onChange={(value: { disableActions: string[] }) => {
            form.setValue('capabilities', value);
            onSubmit(form.getValues());
          }}
        />
        <FormField
          control={form.control}
          name="enable"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between py-4">
              <div className="space-y-0.5">
                <FormLabel className="text-lg font-medium">
                  {t('admin.setting.ai.customModel')}
                </FormLabel>
                <FormDescription className="text-left text-xs text-muted-foreground">
                  {t('admin.setting.ai.customModelDescription')}
                </FormDescription>
              </div>
              <FormControl>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Switch
                        disabled={switchEnable}
                        checked={field.value}
                        onCheckedChange={(checked) => {
                          field.onChange(checked);
                          onSubmit(form.getValues());
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipPortal>
                      {switchEnable && (
                        <TooltipContent>
                          <p>{t('space:aiSetting.enableSwitchTips')}</p>
                        </TooltipContent>
                      )}
                    </TooltipPortal>
                  </Tooltip>
                </TooltipProvider>
              </FormControl>
            </FormItem>
          )}
        />
        <div>
          <div className="flex items-center justify-between pb-2">
            <div className="text-lg font-medium">{t('admin.setting.ai.provider')}</div>
            <div className="flex items-center gap-2">
              {/* Fetch Pricing - Cloud only (for billing) */}
              {isCloud && (
                <FetchPricing providers={llmProviders} onUpdateProviders={updateProviders} />
              )}
              <BatchTestModels
                providers={llmProviders}
                disabled={!llmProviders?.length}
                onResultsChange={setModelTestResults}
                onSaveResult={onSaveTestResult}
                onTestingProvidersChange={setTestingProviders}
                onTestProvider={(callback) => {
                  testProviderCallbackRef.current = callback;
                }}
              />
            </div>
          </div>
          <AIProviderCard
            control={form.control}
            onChange={updateProviders}
            onTest={onTest}
            modelTestResults={modelTestResults}
            onToggleImageModel={onToggleImageModel}
            onTestProvider={(provider) => testProviderCallbackRef.current?.(provider)}
            testingProviders={testingProviders}
          />
        </div>
        {!enable && (
          <div className="!mt-2 text-xs text-red-500">
            {t('admin.configuration.list.llmApi.errorTips')}
          </div>
        )}

        <div className="flex flex-col gap-y-4">
          <div className="text-lg font-medium">{t('admin.setting.ai.modelPreferences')}</div>
          <div className="text-base font-medium">{t(`admin.setting.ai.chatModel`)}</div>
          <AIModelPreferencesCard
            control={form.control}
            models={models}
            onChange={() => onSubmit(form.getValues())}
            onTestChatModelAbility={onTestChatModelAbility}
            onEnableAI={() => {
              form.setValue('enable', true);
              onSubmit(form.getValues());
            }}
          />
        </div>

        {!llmProviders?.length && (
          <div className="!mt-2 text-xs text-red-500">
            {t('admin.configuration.list.llmApi.errorTips')}
          </div>
        )}
      </form>
    </Form>
  );
}
