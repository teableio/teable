import type { IAIIntegrationConfig } from '@teable/openapi';
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
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { Control } from 'react-hook-form';
import type { IModelOption } from './AiModelSelect';
import { AIModelSelect } from './AiModelSelect';
import { CodingModels } from './CodingModels';

interface IAIModelPreferencesCardProps {
  control: Control<IAIIntegrationConfig>;
  models: IModelOption[];
  onChange?: () => void;
}

export const AIModelPreferencesCard = ({
  control,
  models,
  onChange,
}: IAIModelPreferencesCardProps) => {
  const { t } = useTranslation('common');

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>{t('admin.setting.ai.modelPreferences')}</CardTitle>
        {/* <CardDescription>{t('admin.setting.ai.modelPreferencesDescription')}</CardDescription> */}
      </CardHeader>
      <CardContent className="space-y-6">
        <FormField
          control={control}
          name={'codingModels'}
          render={({ field }) => (
            <FormItem>
              <div className="flex justify-between">
                <FormLabel className="w-1/3">
                  {t(`admin.setting.ai.codingModel`)}
                  <FormDescription className="mt-2">
                    {t(`admin.setting.ai.codingModelDescription`)}
                  </FormDescription>
                </FormLabel>
                <div className="flex w-2/3 space-x-2">
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
