import { zodResolver } from '@hookform/resolvers/zod';
import type { IAIIntegrationConfig } from '@teable/openapi';
import type { LLMProvider } from '@teable/openapi/src/admin/setting';
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
import { useCallback, useEffect, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { AIControlCard } from './AIControlCard';
import { AIModelPreferencesCard } from './AIModelPreferencesCard';
import { AIProviderCard } from './AIProviderCard';
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

  const onTest = async (data: Required<LLMProvider>) => testLLM(data);

  const enableAi = form.watch('enable');

  const switchEnable = useMemo(() => {
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
    return testLLM({
      ...testLLMProvider,
      modelKey: testModelKey,
      ability: Object.values(chatModelAbilityType.Values),
    }).then((res) => {
      if (res.success) {
        return res.ability;
      }
    });
  };

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
                <FormDescription className="text-left text-xs text-zinc-500">
                  {t('admin.setting.ai.enableDescription')}
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
        <AIProviderCard control={form.control} onChange={updateProviders} onTest={onTest} />
        {!enable && (
          <div className="!mt-2 text-xs text-red-500">
            {t('admin.configuration.list.llmApi.errorTips')}
          </div>
        )}
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
        <AIControlCard
          disableActions={aiConfig?.capabilities?.disableActions || []}
          onChange={(value: { disableActions: string[] }) => {
            form.setValue('capabilities', value);
            onSubmit(form.getValues());
          }}
        />
        {!llmProviders?.length && (
          <div className="!mt-2 text-xs text-red-500">
            {t('admin.configuration.list.llmApi.errorTips')}
          </div>
        )}
      </form>
    </Form>
  );
}
