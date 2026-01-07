import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { testIntegrationLLM, type IAIIntegrationConfig } from '@teable/openapi';
import type {
  IChatModelAbility,
  IImageModelAbility,
  LLMProvider,
} from '@teable/openapi/src/admin/setting';
import {
  aiConfigVoSchema,
  chatModelAbilityType,
  getPublicSetting,
} from '@teable/openapi/src/admin/setting';
import { Form, Input, toast } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { useIsEE } from '@/features/app/hooks/useIsEE';
import { AIControlCard } from '../../../admin/setting/components/ai-config/AIControlCard';
import { AIModelPreferencesCard } from '../../../admin/setting/components/ai-config/AIModelPreferencesCard';
import { AIProviderCard } from '../../../admin/setting/components/ai-config/AIProviderCard';
import { BatchTestModels } from '../../../admin/setting/components/ai-config/BatchTestModels';
import type { IModelTestResult } from '../../../admin/setting/components/ai-config/LlmproviderManage';
import {
  generateModelKeyList,
  parseModelKey,
} from '../../../admin/setting/components/ai-config/utils';

interface IAIConfigProps {
  config: IAIIntegrationConfig;
  onChange: (value: IAIIntegrationConfig) => void;
  onEnableAI?: () => void;
  children: ReactElement;
}

export const AIConfig = (props: IAIConfigProps) => {
  const { config, onChange, onEnableAI: onEnableAIProp, children } = props;
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
  const models = generateModelKeyList(llmProviders);
  const { reset } = form;
  const { t } = useTranslation('common');
  const isEE = useIsEE();
  const isCloud = useIsCloud();

  // State for batch testing models
  const [modelTestResults, setModelTestResults] = useState<Map<string, IModelTestResult>>(
    new Map()
  );
  const [testingProviders, setTestingProviders] = useState<Set<string>>(new Set());
  const testProviderCallbackRef = useRef<((provider: LLMProvider) => void) | null>(null);

  const { mutateAsync: onTestChatModelAbility } = useMutation({
    mutationFn: async (chatModel: IAIIntegrationConfig['chatModel']) => {
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
      return testIntegrationLLM(spaceId, {
        ...testLLMProvider,
        modelKey: testModelKey,
        ability: chatModelAbilityType.options,
      }).then((res) => {
        if (res.success) {
          return res.ability;
        }
      });
    },
  });

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

  const onTest = async (data: Required<LLMProvider>) => testIntegrationLLM(spaceId, data);

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

  // Enable custom model (AI) - calls the parent's enable handler
  const onEnableAI = useCallback(() => {
    onEnableAIProp?.();
  }, [onEnableAIProp]);

  const { data: setting } = useQuery({
    queryKey: ['public-setting'],
    queryFn: () => getPublicSetting().then(({ data }) => data),
  });

  const instanceAIDisableActions = setting?.aiConfig?.capabilities?.disableActions || [];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <AIControlCard
          disableActions={config?.capabilities?.disableActions || instanceAIDisableActions}
          onChange={(value: { disableActions: string[] }) => {
            form.setValue('capabilities', value);
            onSubmit(form.getValues());
          }}
        />
        {children}
        <div>
          <div className="flex items-center justify-between pb-2">
            <div className="text-lg font-medium">{t('admin.setting.ai.provider')}</div>
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
          <AIProviderCard
            control={form.control}
            onChange={onProvidersUpdate}
            onTest={onTest}
            modelTestResults={modelTestResults}
            onToggleImageModel={onToggleImageModel}
            onTestProvider={(provider) => testProviderCallbackRef.current?.(provider)}
            testingProviders={testingProviders}
            hideModelRates
          />
        </div>
        <div className="flex flex-col gap-y-2">
          <div className="text-lg font-medium">{t('admin.setting.ai.modelPreferences')}</div>
          <div className="text-base font-medium">{t(`admin.setting.ai.chatModel`)}</div>
          <AIModelPreferencesCard
            control={form.control}
            models={models}
            onChange={() => onSubmit(form.getValues())}
            onTestChatModelAbility={onTestChatModelAbility}
            onEnableAI={onEnableAI}
          />
        </div>
        {/* App Configuration Section */}
        {(isEE || isCloud) && (
          <div className="relative flex flex-col gap-2">
            <div className="text-left text-lg font-semibold text-foreground">{t('app.title')}</div>
            <div className="flex flex-col gap-4 overflow-hidden">
              <div className="relative flex flex-col gap-1">
                <div className="text-left text-xs text-muted-foreground">
                  <Trans
                    ns="common"
                    i18nKey="app.description"
                    components={{
                      a: (
                        <Link
                          className="cursor-pointer text-blue-500"
                          href="https://v0.app/chat/settings/keys"
                          target="_blank"
                          rel="noreferrer"
                        />
                      ),
                    }}
                  />
                </div>
              </div>
              <div className="relative flex flex-col gap-2">
                <div className="self-stretch text-left text-sm font-medium text-foreground">
                  {t('admin.setting.app.v0ApiKey')}
                </div>
                <div className="flex flex-col gap-2 p-0.5">
                  <Input
                    type="password"
                    value={form.watch('appConfig')?.apiKey}
                    placeholder={t('admin.action.enterApiKey')}
                    onChange={(e) => {
                      const value = e.target.value?.trim();
                      form.setValue('appConfig', { ...config?.appConfig, apiKey: value });
                    }}
                    onBlur={() => {
                      onSubmit(form.getValues());
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Web Search Configuration Section */}
        {(isEE || isCloud) && (
          <div className="relative flex flex-col gap-2">
            <div className="flex flex-col gap-4 overflow-hidden">
              <div className="text-left text-lg font-semibold text-foreground">
                {t('admin.configuration.list.webSearch.title')}
              </div>
              <div className="relative flex flex-col gap-1">
                <div className="text-left text-xs text-muted-foreground">
                  <Trans
                    ns="common"
                    i18nKey="admin.setting.webSearch.description"
                    components={{
                      a: (
                        <Link
                          className="cursor-pointer text-blue-500"
                          href="https://www.firecrawl.dev/app/api-keys"
                          target="_blank"
                          rel="noreferrer"
                        />
                      ),
                    }}
                  />
                </div>
              </div>
              <div className="relative flex flex-col gap-2">
                <div className="self-stretch text-left text-sm font-medium text-foreground">
                  {t('admin.setting.ai.apiKey')}
                </div>
                <div className="flex flex-col gap-2 p-0.5">
                  <Input
                    type="password"
                    value={form.watch('webSearchConfig')?.apiKey}
                    placeholder={t('admin.action.enterApiKey')}
                    onChange={(e) => {
                      const value = e.target.value?.trim();
                      form.setValue('webSearchConfig', {
                        ...config?.webSearchConfig,
                        apiKey: value,
                      });
                    }}
                    onBlur={() => {
                      onSubmit(form.getValues());
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </form>
    </Form>
  );
};
