import { zodResolver } from '@hookform/resolvers/zod';
import type { LLMProvider } from '@teable/openapi/src/admin/setting';
import { aiConfigSchema } from '@teable/openapi/src/admin/setting';
import type { ISettingVo } from '@teable/openapi/src/admin/setting/get';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Switch,
  toast,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';

import { AIModelSelect } from './ai-model-select';
import { LLMProviderManage } from './llm-provider-manage';
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
    resolver: zodResolver(aiConfigSchema),
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
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>{t('admin.setting.ai.provider')}</CardTitle>
            <CardDescription>{t('admin.setting.ai.providerDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="llmProviders"
              render={({ field }) => (
                <FormItem className="flex flex-col">
                  <FormControl>
                    <LLMProviderManage {...field} onChange={updateProviders} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>{t('admin.setting.ai.modelPreferences')}</CardTitle>
            <CardDescription>{t('admin.setting.ai.modelPreferencesDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <FormField
              control={form.control}
              name="codingModel"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="w-1/3">
                      {t('admin.setting.ai.codingModel')}
                      <FormDescription className="mt-2">
                        {t('admin.setting.ai.codingModelDescription')}
                      </FormDescription>
                    </FormLabel>
                    <div className="flex w-2/3 space-x-2">
                      <FormControl className="grow">
                        <AIModelSelect
                          value={field.value ?? ''}
                          onValueChange={(value) => {
                            field.onChange(value);
                            onSubmit(form.getValues());
                          }}
                          options={models}
                        />
                      </FormControl>
                    </div>
                  </div>

                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="embeddingModel"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel className="w-1/3">
                      {t('admin.setting.ai.embeddingModel')}
                      <FormDescription className="mt-2">
                        {t('admin.setting.ai.embeddingModelDescription')}
                      </FormDescription>
                    </FormLabel>
                    <div className="flex w-2/3 space-x-2">
                      <FormControl className="grow">
                        <AIModelSelect
                          value={field.value ?? ''}
                          onValueChange={(value) => {
                            field.onChange(value);
                            onSubmit(form.getValues());
                          }}
                          options={models}
                        />
                      </FormControl>
                    </div>
                  </div>

                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>
      </form>
    </Form>
  );
}
