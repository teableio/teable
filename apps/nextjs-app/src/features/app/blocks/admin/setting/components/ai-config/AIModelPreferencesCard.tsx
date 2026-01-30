import type { IAIIntegrationConfig, IChatModelAbility, ISettingVo } from '@teable/openapi';
import {
  Card,
  CardContent,
  CardHeader,
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
  onEnableAI?: () => void;
  onTestChatModelAbility?: (
    chatModel: IAIIntegrationConfig['chatModel']
  ) => Promise<IChatModelAbility | undefined>;
  needGroup?: boolean;
  hideEmbeddingModel?: boolean;
  /** Optional header title */
  title?: string;
}

export const AIModelPreferencesCard = ({
  control,
  models,
  onChange,
  onTestChatModelAbility,
  onEnableAI,
  needGroup,
  hideEmbeddingModel,
  title,
}: IAIModelPreferencesCardProps) => {
  const { t } = useTranslation('common');

  return (
    <Card className="shadow-sm">
      {title && (
        <CardHeader className="px-4 pb-0 pt-4">
          <div className="text-sm font-semibold">{title}</div>
        </CardHeader>
      )}
      <CardContent className="p-4">
        <div className="space-y-6">
          <FormField
            control={control}
            name={'chatModel'}
            render={({ field }) => (
              <FormItem>
                <div className="flex w-full flex-col justify-between">
                  <div className="flex flex-1 space-x-2">
                    <FormControl className="grow ">
                      <CodingModels
                        value={field.value}
                        onChange={(value) => {
                          field.onChange(value);
                          onChange?.();
                        }}
                        models={models}
                        onTestChatModelAbility={onTestChatModelAbility}
                        onEnableAI={onEnableAI}
                        formValues={control._formValues as NonNullable<ISettingVo['aiConfig']>}
                        needGroup={needGroup}
                      />
                    </FormControl>
                  </div>
                </div>
                <FormMessage />
              </FormItem>
            )}
          />
          {!hideEmbeddingModel && (
            <FormField
              control={control}
              name="embeddingModel"
              render={({ field }) => (
                <FormItem>
                  <div className="flex flex-col items-center justify-between">
                    <FormLabel className="flex w-full flex-col items-start justify-start gap-2">
                      <span>{t('admin.setting.ai.embeddingModel')}</span>
                      <FormDescription className="text-left text-xs text-muted-foreground">
                        {t('admin.setting.ai.embeddingModelDescription')}
                      </FormDescription>
                    </FormLabel>
                    <div className="flex w-full space-x-2 pt-2">
                      <FormControl className="grow">
                        <AIModelSelect
                          value={field.value ?? ''}
                          onValueChange={(value) => {
                            field.onChange(value);
                            onChange?.();
                          }}
                          options={models}
                          needGroup={needGroup}
                        />
                      </FormControl>
                    </div>
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
};
