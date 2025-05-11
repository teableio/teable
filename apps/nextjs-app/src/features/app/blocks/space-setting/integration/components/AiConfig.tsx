import { zodResolver } from '@hookform/resolvers/zod';
import type { IAIIntegrationConfig } from '@teable/openapi';
import type { LLMProvider } from '@teable/openapi/src/admin/setting';
import { aiConfigVoSchema } from '@teable/openapi/src/admin/setting';
import { Form, toast } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { AIModelPreferencesCard } from '../../../admin/setting/components/ai-config/AIModelPreferencesCard';
import { AIProviderCard } from '../../../admin/setting/components/ai-config/AIProviderCard';
import { generateModelKeyList } from '../../../admin/setting/components/ai-config/utils';

interface IAIConfigProps {
  config: IAIIntegrationConfig;
  onChange: (value: IAIIntegrationConfig) => void;
}

export const AIConfig = (props: IAIConfigProps) => {
  const { config, onChange } = props;
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

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const onSubmit = (data: IAIIntegrationConfig) => {
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <AIProviderCard control={form.control} onChange={onProvidersUpdate} />
        <AIModelPreferencesCard
          control={form.control}
          models={models}
          onChange={() => onSubmit(form.getValues())}
        />
      </form>
    </Form>
  );
};
