import type { IAIIntegrationConfig } from '@teable/openapi';
import type { ITestLLMVo, LLMProvider } from '@teable/openapi/src/admin/setting';
import {
  Card,
  CardContent,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@teable/ui-lib/shadcn';
import type { Control } from 'react-hook-form';
import { LLMProviderManage } from './LlmproviderManage';

interface IAIProviderCardProps {
  control: Control<IAIIntegrationConfig>;
  onChange?: (value: LLMProvider[]) => void;
  onTest?: (data: Required<LLMProvider>) => Promise<ITestLLMVo>;
}

export const AIProviderCard = ({ control, onChange, onTest }: IAIProviderCardProps) => {
  return (
    <Card className="pt-6 shadow-sm">
      <CardContent>
        <FormField
          control={control}
          name="llmProviders"
          render={({ field }) => (
            <FormItem className="flex flex-col">
              <FormControl>
                <LLMProviderManage
                  {...field}
                  onChange={(value) => onChange?.(value)}
                  onTest={onTest}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </CardContent>
    </Card>
  );
};
