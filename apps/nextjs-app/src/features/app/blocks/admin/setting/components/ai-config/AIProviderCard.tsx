import type {
  IAIIntegrationConfig,
  IChatModelAbility,
  IImageModelAbility,
  ITestLLMRo,
  ITestLLMVo,
  LLMProvider,
} from '@teable/openapi';
import {
  Card,
  CardContent,
  CardHeader,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from '@teable/ui-lib/shadcn';
import type { ReactNode } from 'react';
import type { Control } from 'react-hook-form';
import type { IModelTestResult } from './LlmproviderManage';
import { LLMProviderManage } from './LlmproviderManage';

interface IAIProviderCardProps {
  control: Control<IAIIntegrationConfig>;
  onChange?: (value: LLMProvider[]) => void;
  /** Test function - accepts full ITestLLMRo for capability testing */
  onTest?: (data: ITestLLMRo) => Promise<ITestLLMVo>;
  modelTestResults?: Map<string, IModelTestResult>;
  onToggleImageModel?: (modelKey: string, isImageModel: boolean) => void;
  onTestProvider?: (provider: LLMProvider) => void;
  onTestModel?: (provider: LLMProvider, model: string, modelKey: string) => Promise<void>;
  testingProviders?: Set<string>;
  testingModels?: Set<string>;
  /** Hide model rates config (for space-level settings where billing doesn't apply) */
  hideModelRates?: boolean;
  /** Callback to save model test results */
  onSaveTestResult?: (
    modelKey: string,
    ability: IChatModelAbility | undefined,
    imageAbility: IImageModelAbility | undefined
  ) => void;
  /** Optional header title */
  title?: string;
  /** Optional header actions (e.g., BatchTestModels) */
  headerActions?: ReactNode;
}

export const AIProviderCard = ({
  control,
  onChange,
  onTest,
  modelTestResults,
  onToggleImageModel,
  onTestProvider,
  onTestModel,
  testingProviders,
  testingModels,
  hideModelRates,
  onSaveTestResult,
  title,
  headerActions,
}: IAIProviderCardProps) => {
  return (
    <Card className="shadow-sm">
      {(title || headerActions) && (
        <CardHeader className="flex flex-row items-center justify-between space-y-0 px-4 pb-0 pt-4">
          {title && <div className="text-sm font-semibold">{title}</div>}
          {headerActions}
        </CardHeader>
      )}
      <CardContent className="p-4">
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
                  onTestModel={onTestModel}
                  testingProviders={testingProviders}
                  testingModels={testingModels}
                  hideModelRates={hideModelRates}
                  onSaveTestResult={onSaveTestResult}
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
