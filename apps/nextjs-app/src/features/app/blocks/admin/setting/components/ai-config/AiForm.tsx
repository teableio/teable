import { zodResolver } from '@hookform/resolvers/zod';
import type { LLMProvider } from '@teable/openapi/src/admin/setting';
import { aiConfigVoSchema } from '@teable/openapi/src/admin/setting';
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
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { AIModelPreferencesCard } from './AIModelPreferencesCard';
import { AIProviderCard } from './AIProviderCard';
import { generateModelKeyList } from './util';

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
  const models = generateModelKeyList(llmProviders);
  const { reset } = form;
  const { t } = useTranslation('common');

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  function onSubmit(data: NonNullable<ISettingVo['aiConfig']>) {
    setAiConfig(data);
    toast({
      title: t('admin.setting.ai.configUpdated'),
    });
  }

  function updateProviders(providers: LLMProvider[]) {
    form.setValue('llmProviders', providers);
    form.trigger('llmProviders');
    onSubmit(form.getValues());
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="enable"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 shadow-sm">
              <div className="space-y-0.5">
                <FormLabel className="text-base">{t('admin.setting.ai.enable')}</FormLabel>
                <FormDescription>{t('admin.setting.ai.enableDescription')}</FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    field.onChange(checked);
                    onSubmit(form.getValues());
                  }}
                />
              </FormControl>
            </FormItem>
          )}
        />
        <AIProviderCard control={form.control} onChange={updateProviders} />
        <AIModelPreferencesCard
          control={form.control}
          models={models}
          onChange={() => onSubmit(form.getValues())}
        />
      </form>
    </Form>
  );
}
