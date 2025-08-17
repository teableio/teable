import { Loader2 } from '@teable/icons';
import type { IAIIntegrationConfig, IChatModelAbility } from '@teable/openapi';
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  FormField,
  FormItem,
  FormLabel,
  FormDescription,
  FormControl,
  FormMessage,
  Button,
  cn,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { useTranslation } from 'next-i18next';
import { useState } from 'react';
import type { Control } from 'react-hook-form';
import type { IModelOption } from './AiModelSelect';
import { AIModelSelect } from './AiModelSelect';
import { CodingModels } from './CodingModels';

interface IAIModelPreferencesCardProps {
  control: Control<IAIIntegrationConfig>;
  models: IModelOption[];
  onChange?: () => void;
  onTestChatModelAbility?: (data: IAIIntegrationConfig) => Promise<IChatModelAbility | undefined>;
}

export const AIModelPreferencesCard = ({
  control,
  models,
  onChange,
  onTestChatModelAbility,
}: IAIModelPreferencesCardProps) => {
  const { t } = useTranslation('common');

  const [testChatModelAbilityLoading, setTestChatModelAbilityLoading] = useState(false);

  const testChatModelAbility = async (data: IAIIntegrationConfig) => {
    if (testChatModelAbilityLoading) {
      return;
    }
    if (!data.chatModel?.lg) {
      toast.error(t(`admin.setting.ai.chatModelTest.notConfigLgModel`));
      return;
    }
    setTestChatModelAbilityLoading(true);
    const res = await onTestChatModelAbility?.(data);
    setTestChatModelAbilityLoading(false);
    return res;
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>{t('admin.setting.ai.modelPreferences')}</CardTitle>
        {/* <CardDescription>{t('admin.setting.ai.modelPreferencesDescription')}</CardDescription> */}
      </CardHeader>
      <CardContent className="space-y-6">
        <FormField
          control={control}
          name={'chatModel'}
          render={({ field }) => (
            <FormItem>
              <div className="flex justify-between">
                <FormLabel className="w-1/3">
                  {t(`admin.setting.ai.chatModel`)}
                  <Button
                    size="xs"
                    className="relative ml-2"
                    variant="outline"
                    onClick={async () => {
                      const res = await testChatModelAbility(
                        control._formValues as IAIIntegrationConfig
                      );
                      field.onChange({
                        ...field.value,
                        ability: res || {},
                      });
                      onChange?.();
                    }}
                  >
                    {testChatModelAbilityLoading && (
                      <Loader2 className="absolute size-4 animate-spin" />
                    )}
                    <span
                      className={cn({
                        'opacity-40': testChatModelAbilityLoading,
                      })}
                    >
                      {t(`admin.setting.ai.chatModelTest.text`)}
                    </span>
                  </Button>
                  <FormDescription className="mt-2">
                    {t(`admin.setting.ai.chatModelDescription`)}
                  </FormDescription>
                </FormLabel>

                <div className="flex flex-1 space-x-2">
                  <FormControl className="grow">
                    <CodingModels
                      value={field.value}
                      onChange={(value) => {
                        field.onChange(value);
                        onChange?.();
                      }}
                      models={models}
                    />
                  </FormControl>
                </div>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={control}
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
                        onChange?.();
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
  );
};
