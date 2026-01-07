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
import type { IModelTestResult } from './LlmproviderManage';
import { LLMProviderManage } from './LlmproviderManage';

interface IAIProviderCardProps {
  control: Control<IAIIntegrationConfig>;
  onChange?: (value: LLMProvider[]) => void;
  onTest?: (data: Required<LLMProvider>) => Promise<ITestLLMVo>;
  modelTestResults?: Map<string, IModelTestResult>;
  onToggleImageModel?: (modelKey: string, isImageModel: boolean) => void;
  onTestProvider?: (provider: LLMProvider) => void;
  testingProviders?: Set<string>;
  /** Hide model rates config (for space-level settings where billing doesn't apply) */
  hideModelRates?: boolean;
}

export const AIProviderCard = ({
  control,
  onChange,
  onTest,
  modelTestResults,
  onToggleImageModel,
  onTestProvider,
  testingProviders,
  hideModelRates,
}: IAIProviderCardProps) => {
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
                  modelTestResults={modelTestResults}
                  onToggleImageModel={onToggleImageModel}
                  onTestProvider={onTestProvider}
                  testingProviders={testingProviders}
                  hideModelRates={hideModelRates}
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
