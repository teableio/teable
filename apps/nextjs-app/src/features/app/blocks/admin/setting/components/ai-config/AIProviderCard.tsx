import type { IAIIntegrationConfig } from '@teable/openapi';
import type { LLMProvider } from '@teable/openapi/src/admin/setting';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import type { Control } from 'react-hook-form';
import { LLMProviderManage } from './LlmproviderManage';

interface IAIProviderCardProps {
  control: Control<IAIIntegrationConfig>;
  onChange?: (value: LLMProvider[]) => void;
}

export const AIProviderCard = ({ control, onChange }: IAIProviderCardProps) => {
  const { t } = useTranslation('common');

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>{t('admin.setting.ai.provider')}</CardTitle>
        {/* <CardDescription>{t('admin.setting.ai.providerDescription')}</CardDescription> */}
      </CardHeader>
      <CardContent>
        <FormField
          control={control}
          name="llmProviders"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormControl>
                <LLMProviderManage {...field} onChange={(value) => onChange?.(value)} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
};
