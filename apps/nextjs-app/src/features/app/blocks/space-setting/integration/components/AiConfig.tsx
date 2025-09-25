import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { testIntegrationLLM, type IAIIntegrationConfig } from '@teable/openapi';
import type { LLMProvider } from '@teable/openapi/src/admin/setting';
import {
  aiConfigVoSchema,
  chatModelAbilityType,
  getPublicSetting,
} from '@teable/openapi/src/admin/setting';
import { Form, Input, toast } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { Trans, useTranslation } from 'next-i18next';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { useIsEE } from '@/features/app/hooks/useIsEE';
import { AIControlCard } from '../../../admin/setting/components/ai-config/AIControlCard';
import { AIModelPreferencesCard } from '../../../admin/setting/components/ai-config/AIModelPreferencesCard';
import { AIProviderCard } from '../../../admin/setting/components/ai-config/AIProviderCard';
import { generateModelKeyList } from '../../../admin/setting/components/ai-config/utils';

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
  const models = generateModelKeyList(llmProviders);
  const { reset } = form;
  const { t } = useTranslation('common');
  const isEE = useIsEE();
  const isCloud = useIsCloud();

  const { mutateAsync: onTestChatModelAbility } = useMutation({
    mutationFn: async (data: IAIIntegrationConfig['chatModel']) => {
      const testModel = data?.lg;
      if (!testModel) {
        return;
      }
      const models = generateModelKeyList(llmProviders);
      const testLLMIndex = models.findIndex((model) => model.modelKey.includes(testModel));
      const testLLM = llmProviders[testLLMIndex] as Required<LLMProvider>;
      if (!testLLM) {
        return;
      }
      return testIntegrationLLM(spaceId, {
        ...testLLM,
        modelKey: testModel,
        ability: Object.values(chatModelAbilityType.Values),
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

  const onSubmit = async (data: IAIIntegrationConfig) => {
    onChange(data);
    toast({
      title: t('admin.setting.ai.configUpdated'),
    });
  };

  const onProvidersUpdate = (providers: LLMProvider[]) => {
    form.setValue('llmProviders', providers);
    form.trigger('llmProviders');
    onSubmit(form.getValues());
  };

  const onTest = async (data: Required<LLMProvider>) => testIntegrationLLM(spaceId, data);

  const { data: setting } = useQuery({
    queryKey: ['public-setting'],
    queryFn: () => getPublicSetting().then(({ data }) => data),
  });

  const instanceAIDisableActions = setting?.aiConfig?.capabilities?.disableActions || [];

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <AIProviderCard control={form.control} onChange={onProvidersUpdate} onTest={onTest} />
        <AIModelPreferencesCard
          control={form.control}
          models={models}
          onChange={() => onSubmit(form.getValues())}
          onTestChatModelAbility={onTestChatModelAbility}
        />
        <AIControlCard
          disableActions={config?.capabilities?.disableActions || instanceAIDisableActions}
          onChange={(value: { disableActions: string[] }) => {
            form.setValue('capabilities', value);
            onSubmit(form.getValues());
          }}
        />
        {/* App Configuration Section */}
        {(isEE || isCloud) && (
          <div className="relative flex flex-col gap-2">
            <div className="flex flex-col gap-4 overflow-hidden rounded-lg border p-4">
              <div className="relative flex flex-col gap-1">
                <div className="text-left text-lg font-semibold text-zinc-900">
                  {t('app.title')}
                </div>
                <div className="text-left text-xs text-zinc-500">
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
                <div className="self-stretch text-left text-sm font-medium text-zinc-900">
                  {t('admin.setting.ai.apiKey')}
                </div>
                <div className="flex flex-col gap-2">
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
            <div className="flex flex-col gap-4 overflow-hidden rounded-lg border p-4">
              <div className="relative flex flex-col gap-1">
                <div className="text-left text-lg font-semibold text-zinc-900">
                  {t('admin.configuration.list.webSearch.title')}
                </div>
                <div className="text-left text-xs text-zinc-500">
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
                <div className="self-stretch text-left text-sm font-medium text-zinc-900">
                  {t('admin.setting.ai.apiKey')}
                </div>
                <div className="flex flex-col gap-2">
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
