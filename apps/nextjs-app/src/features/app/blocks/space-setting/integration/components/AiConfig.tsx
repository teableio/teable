import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { testIntegrationLLM, type IAIIntegrationConfig } from '@teable/openapi';
import type { LLMProvider } from '@teable/openapi/src/admin/setting';
import { aiConfigVoSchema, chatModelAbilityType } from '@teable/openapi/src/admin/setting';
import { Form, toast } from '@teable/ui-lib/shadcn';
import { useRouter } from 'next/router';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
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
          aiControlEnable={config?.capabilities?.enabled ?? false}
          disableActions={config?.capabilities?.disableActions || []}
          onChange={(value: { enabled: boolean; disableActions: string[] }) => {
            form.setValue('capabilities', value);
            onSubmit(form.getValues());
          }}
        />
      </form>
    </Form>
  );
};
