'use client';

import { Check, ArrowUpRight, Database, Zap, AlertTriangle } from '@teable/icons';
import type {
  ISettingVo,
  LLMProvider,
  IChatModelAbility,
  IImageModelAbility,
  IAIIntegrationConfig,
  IAttachmentTestResult,
  ITestLLMRo,
} from '@teable/openapi';
import { Button, Input, Label, cn, Switch } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import { useState, useCallback, useMemo } from 'react';
import type { Control } from 'react-hook-form';
import { useEnv } from '@/features/app/hooks/useEnv';
import { AIProviderCard } from './AIProviderCard';
import type { LLMApiMode } from './AISetupWizard';
import { BatchTestModels } from './BatchTestModels';
import type { IModelTestResult } from './LlmproviderManage';

interface ILLMApiConfigStepProps {
  // Mode selection
  mode: LLMApiMode;
  onModeChange: (mode: LLMApiMode) => void;

  // Gateway config (now part of aiConfig)
  aiConfig?: ISettingVo['aiConfig'];
  onAiConfigChange?: (config: Partial<NonNullable<ISettingVo['aiConfig']>>) => void;

  // Custom provider config
  llmProviders: LLMProvider[];
  onProvidersChange: (providers: LLMProvider[]) => void;
  control: Control<IAIIntegrationConfig>;
  modelTestResults: Map<string, IModelTestResult>;
  onModelTestResultsChange: (results: Map<string, IModelTestResult>) => void;
  testingProviders: Set<string>;
  onTestingProvidersChange: (providers: Set<string>) => void;
  testingModels: Set<string>;
  onTestingModelsChange: (models: Set<string>) => void;
  onSaveTestResult: (
    modelKey: string,
    ability: IChatModelAbility | undefined,
    imageAbility: IImageModelAbility | undefined
  ) => void;
  onToggleImageModel: (modelKey: string, isImageModel: boolean) => void;
  testProviderCallbackRef: React.MutableRefObject<((provider: LLMProvider) => void) | null>;
  testModelCallbackRef: React.MutableRefObject<
    ((provider: LLMProvider, model: string, modelKey: string) => Promise<void>) | null
  >;

  // Callbacks
  onComplete?: () => void;

  /** Whether to show pricing-related UI. Defaults to true (Cloud). */
  showPricing?: boolean;
}

export function LLMApiConfigStep({
  mode,
  onModeChange,
  aiConfig,
  onAiConfigChange,
  llmProviders,
  onProvidersChange,
  control,
  modelTestResults,
  onModelTestResultsChange,
  testingProviders,
  onTestingProvidersChange,
  testingModels,
  onTestingModelsChange,
  onSaveTestResult,
  onToggleImageModel,
  testProviderCallbackRef,
  testModelCallbackRef,
  onComplete,
  showPricing = true,
}: ILLMApiConfigStepProps) {
  const { t } = useTranslation('common');
  const { publicOrigin } = useEnv();
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testErrorMessage, setTestErrorMessage] = useState<string | null>(null);
  const [attachmentTestResult, setAttachmentTestResult] = useState<IAttachmentTestResult | null>(
    null
  );

  const hasGatewayKey = Boolean(aiConfig?.aiGatewayApiKey);
  const hasProviders = llmProviders.length > 0;

  // Determine if current mode is ready to proceed
  const canProceed = mode === 'gateway' ? hasGatewayKey : hasProviders;

  // Get saved attachment test from aiConfig
  const savedAttachmentTest = useMemo(() => aiConfig?.attachmentTest, [aiConfig?.attachmentTest]);
  const currentTransferMode = aiConfig?.attachmentTransferMode || 'url';

  // Check if PUBLIC_ORIGIN has changed since last test
  const originChanged = useMemo(() => {
    const testedOrigin = savedAttachmentTest?.testedOrigin;
    if (!testedOrigin || !publicOrigin) return false;
    return testedOrigin !== publicOrigin;
  }, [savedAttachmentTest?.testedOrigin, publicOrigin]);

  const handleTestGateway = useCallback(async () => {
    if (!aiConfig?.aiGatewayApiKey) return;

    setIsTesting(true);
    setTestResult(null);
    setTestErrorMessage(null);
    setAttachmentTestResult(null);

    try {
      const { testApiKey } = await import('@teable/openapi');
      const result = await testApiKey({
        type: 'aiGateway',
        apiKey: aiConfig.aiGatewayApiKey,
        baseUrl: aiConfig.aiGatewayBaseUrl,
        testAttachment: true, // Also test attachment transfer modes
      });

      if (result.success) {
        setTestResult('success');
        // Save attachment test result
        if (result.attachmentTest) {
          setAttachmentTestResult(result.attachmentTest);
        }
        return;
      }

      // Handle error codes
      setTestResult('error');
      switch (result.error?.code) {
        case 'unauthorized':
          setTestErrorMessage(t('admin.setting.ai.wizard.gatewayErrorUnauthorized'));
          break;
        case 'forbidden':
          setTestErrorMessage(t('admin.setting.ai.wizard.gatewayErrorForbidden'));
          break;
        case 'need_credit_card':
          setTestErrorMessage(t('admin.setting.ai.wizard.gatewayErrorNeedCreditCard'));
          break;
        case 'insufficient_quota':
          setTestErrorMessage(t('admin.setting.ai.wizard.gatewayErrorInsufficientQuota'));
          break;
        case 'network_error':
          setTestErrorMessage(t('admin.setting.ai.wizard.gatewayErrorNetwork'));
          break;
        default:
          setTestErrorMessage(result.error?.message || t('admin.setting.ai.wizard.keyInvalid'));
      }
    } catch {
      setTestResult('error');
      setTestErrorMessage(t('admin.setting.ai.wizard.gatewayErrorNetwork'));
    } finally {
      setIsTesting(false);
    }
  }, [aiConfig?.aiGatewayApiKey, aiConfig?.aiGatewayBaseUrl, t]);

  // Handle manual mode switch
  const handleTransferModeChange = useCallback(
    (useBase64: boolean) => {
      const newMode = useBase64 ? 'base64' : 'url';
      onAiConfigChange?.({ ...aiConfig, attachmentTransferMode: newMode });
    },
    [aiConfig, onAiConfigChange]
  );

  // Determine the effective attachment test result (from current test or saved)
  const effectiveAttachmentTest = attachmentTestResult || savedAttachmentTest;

  const handleTest = async (data: ITestLLMRo) => {
    const { testLLM } = await import('@teable/openapi');
    return testLLM(data);
  };

  return (
    <div className="space-y-6">
      {/* Mode Selection - using div buttons instead of RadioGroup to avoid double-trigger */}
      <div className="grid grid-cols-2 gap-3">
        {/* Gateway Option */}
        <div
          className={cn(
            'relative flex cursor-pointer flex-col rounded-lg border p-4 transition-all',
            mode === 'gateway'
              ? 'border-primary bg-accent'
              : 'border-border hover:border-primary/30'
          )}
          role="button"
          tabIndex={0}
          onClick={() => onModeChange('gateway')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onModeChange('gateway');
            }
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-lg',
                mode === 'gateway' ? 'bg-primary text-primary-foreground' : 'bg-surface'
              )}
            >
              <Zap className="size-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-semibold">AI Gateway</span>
                <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {t('admin.setting.ai.recommended')}
                </span>
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('admin.setting.ai.wizard.gatewayOption.desc')}
          </p>
        </div>

        {/* Custom Provider Option */}
        <div
          className={cn(
            'relative flex cursor-pointer flex-col rounded-lg border p-4 transition-all',
            mode === 'custom' ? 'border-primary bg-accent' : 'border-border hover:border-primary/30'
          )}
          role="button"
          tabIndex={0}
          onClick={() => onModeChange('custom')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onModeChange('custom');
            }
          }}
        >
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg',
                mode === 'custom' ? 'bg-primary text-primary-foreground' : 'bg-surface'
              )}
            >
              <Database className="size-4" />
            </div>
            <span className="truncate font-semibold">
              {t('admin.setting.ai.wizard.customOption.title')}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t('admin.setting.ai.wizard.customOption.desc')}
          </p>
        </div>
      </div>

      {/* Gateway Configuration */}
      {mode === 'gateway' && (
        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
          {/* Help text */}
          <div className="rounded-md bg-background text-sm text-muted-foreground">
            {t('admin.setting.ai.wizard.gatewayHelp')}{' '}
            <Link
              href="https://vercel.com/docs/ai-gateway/byok"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              BYOK
            </Link>
            {t('admin.setting.ai.wizard.gatewayByok')}
          </div>

          {/* API Key Input */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="gateway-key">{t('admin.setting.app.aiGatewayApiKey')} *</Label>
              <Button variant="outline" size="xs" asChild className="h-6 gap-1 px-2 text-xs">
                <Link
                  href="https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%2Fapi-keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('admin.setting.ai.wizard.getApiKey')}
                  <ArrowUpRight className="size-3" />
                </Link>
              </Button>
            </div>
            <div className="flex gap-2">
              <Input
                id="gateway-key"
                type="password"
                value={aiConfig?.aiGatewayApiKey || ''}
                placeholder={t('admin.action.enterApiKey')}
                onChange={(e) => {
                  const value = e.target.value?.trim() || undefined;
                  onAiConfigChange?.({ ...aiConfig, aiGatewayApiKey: value });
                  setTestResult(null);
                }}
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={handleTestGateway}
                disabled={!hasGatewayKey || isTesting}
              >
                {isTesting
                  ? t('admin.setting.ai.wizard.testing')
                  : t('admin.setting.ai.wizard.test')}
              </Button>
            </div>

            {/* Status indicator - only show after test */}
            {testResult === 'success' && (
              <div className="flex items-center gap-1.5 text-sm text-green-600 dark:text-green-400">
                <Check className="size-4" />
                <span>{t('admin.setting.app.aiGatewayKeyConfigured')}</span>
              </div>
            )}
            {testResult === 'error' && (
              <div className="text-sm text-destructive">
                {testErrorMessage || t('admin.setting.ai.wizard.keyInvalid')}
              </div>
            )}
            {hasGatewayKey && !testResult && (
              <p className="text-xs text-muted-foreground">
                {t('admin.setting.ai.wizard.pleaseTest')}
              </p>
            )}

            {/* Origin Changed Warning */}
            {originChanged && savedAttachmentTest && (
              <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <div className="text-sm">
                  <div className="font-medium">
                    {t('admin.setting.ai.wizard.attachmentTest.originChanged')}
                  </div>
                  <div className="mt-1 text-xs">
                    {t('admin.setting.ai.wizard.attachmentTest.originChangedDesc')}
                  </div>
                </div>
              </div>
            )}

            {/* Attachment Transfer Mode Test Results */}
            {effectiveAttachmentTest && !originChanged && (
              <div className="mt-3 rounded-md border bg-muted p-3">
                <div className="mb-2 text-sm font-medium">
                  {t('admin.setting.ai.wizard.attachmentTest.title')}
                </div>
                <div className="space-y-2 text-sm">
                  {/* URL Mode Result */}
                  <div className="flex items-center gap-2">
                    {effectiveAttachmentTest.urlMode?.success ? (
                      <Check className="size-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <AlertTriangle className="size-4 text-amber-500" />
                    )}
                    <span>
                      {t('admin.setting.ai.wizard.attachmentTest.urlMode')}:{' '}
                      {effectiveAttachmentTest.urlMode?.success
                        ? t('admin.setting.ai.wizard.attachmentTest.accessible')
                        : t('admin.setting.ai.wizard.attachmentTest.inaccessible')}
                    </span>
                  </div>
                  {/* Base64 Mode Result */}
                  <div className="flex items-center gap-2">
                    {effectiveAttachmentTest.base64Mode?.success ? (
                      <Check className="size-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <AlertTriangle className="size-4 text-amber-500" />
                    )}
                    <span>
                      {t('admin.setting.ai.wizard.attachmentTest.base64Mode')}:{' '}
                      {effectiveAttachmentTest.base64Mode?.success
                        ? t('admin.setting.ai.wizard.attachmentTest.accessible')
                        : t('admin.setting.ai.wizard.attachmentTest.inaccessible')}
                    </span>
                  </div>
                  {/* Warning if URL mode failed but Base64 works */}
                  {!effectiveAttachmentTest.urlMode?.success &&
                    effectiveAttachmentTest.base64Mode?.success && (
                      <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 p-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        <span className="text-xs">
                          {t('admin.setting.ai.wizard.attachmentTest.urlNotAccessibleWarning')}
                        </span>
                      </div>
                    )}
                  {/* Mode Switch */}
                  <div className="mt-3 flex items-center justify-between border-t pt-3">
                    <div>
                      <div className="text-sm font-medium">
                        {t('admin.setting.ai.wizard.attachmentTest.useBase64Mode')}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {t('admin.setting.ai.wizard.attachmentTest.base64ModeDescription')}
                      </div>
                    </div>
                    <Switch
                      checked={currentTransferMode === 'base64'}
                      onCheckedChange={handleTransferModeChange}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Base URL (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="gateway-url">
              {t('admin.setting.app.aiGatewayBaseUrl')}
              <span className="ml-1 text-xs text-muted-foreground">
                ({t('admin.setting.ai.wizard.optional')})
              </span>
            </Label>
            <Input
              id="gateway-url"
              type="text"
              value={aiConfig?.aiGatewayBaseUrl || ''}
              placeholder="https://ai-gateway.vercel.sh/v1"
              onChange={(e) => {
                const value = e.target.value?.trim() || undefined;
                onAiConfigChange?.({ ...aiConfig, aiGatewayBaseUrl: value });
              }}
            />
          </div>
        </div>
      )}

      {/* Custom Provider Configuration */}
      {mode === 'custom' && (
        <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
          <p className="text-sm text-muted-foreground">
            {t('admin.setting.ai.wizard.customProviderHelp')}
          </p>

          <AIProviderCard
            control={control}
            onChange={onProvidersChange}
            onTest={handleTest}
            modelTestResults={modelTestResults}
            onToggleImageModel={onToggleImageModel}
            onTestProvider={(provider) => testProviderCallbackRef.current?.(provider)}
            onTestModel={(provider, model, modelKey) =>
              testModelCallbackRef.current?.(provider, model, modelKey) ?? Promise.resolve()
            }
            testingProviders={testingProviders}
            testingModels={testingModels}
            hideModelRates={!showPricing}
            onSaveTestResult={onSaveTestResult}
          />

          {/* Test Model Capabilities - moved to bottom */}
          {llmProviders.length > 0 && (
            <div className="space-y-3 border-t pt-4">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  {t('admin.setting.ai.wizard.testModelCapabilities')}
                </div>
                <BatchTestModels
                  providers={llmProviders}
                  disabled={!llmProviders?.length}
                  onTest={handleTest}
                  onResultsChange={(results) => {
                    onModelTestResultsChange(results);
                    // Check if any model supports URL mode for attachments
                    const hasUrlSupport = Array.from(results.values()).some((result) => {
                      if (result.status === 'success' && result.ability?.image) {
                        // ability.image can be a boolean or an object with url/base64 properties
                        const imageAbility = result.ability.image;
                        if (typeof imageAbility === 'object') {
                          return imageAbility.url === true;
                        }
                        // If it's a boolean true, assume URL mode works
                        return imageAbility === true;
                      }
                      return false;
                    });
                    // If any model supports URL mode, set global mode to 'url'
                    // Otherwise, set to 'base64' (safer for internal networks)
                    if (results.size > 0) {
                      const recommendedMode = hasUrlSupport ? 'url' : 'base64';
                      onAiConfigChange?.({
                        ...aiConfig,
                        attachmentTransferMode: recommendedMode,
                        attachmentTest: {
                          urlMode: { success: hasUrlSupport },
                          base64Mode: { success: true }, // Base64 always works for custom providers
                          recommendedMode,
                          testedOrigin: publicOrigin,
                          testedAt: new Date().toISOString(),
                        },
                      });
                    }
                  }}
                  onSaveResult={onSaveTestResult}
                  onTestingProvidersChange={onTestingProvidersChange}
                  onTestingModelsChange={onTestingModelsChange}
                  onTestProvider={(callback) => {
                    testProviderCallbackRef.current = callback;
                  }}
                  onTestModel={(callback) => {
                    testModelCallbackRef.current = callback;
                  }}
                />
              </div>

              {/* Custom Provider Attachment Test Results (reuse same UI) */}
              {aiConfig?.attachmentTest && (
                <div className="rounded-md border bg-background p-3">
                  <div className="mb-2 text-sm font-medium">
                    {t('admin.setting.ai.wizard.attachmentTest.title')}
                  </div>
                  <div className="space-y-2 text-sm">
                    {/* URL Mode Result */}
                    <div className="flex items-center gap-2">
                      {aiConfig.attachmentTest.urlMode?.success ? (
                        <Check className="size-4 text-green-600 dark:text-green-400" />
                      ) : (
                        <AlertTriangle className="size-4 text-amber-500" />
                      )}
                      <span>
                        {t('admin.setting.ai.wizard.attachmentTest.urlMode')}:{' '}
                        {aiConfig.attachmentTest.urlMode?.success
                          ? t('admin.setting.ai.wizard.attachmentTest.accessible')
                          : t('admin.setting.ai.wizard.attachmentTest.inaccessible')}
                      </span>
                    </div>
                    {/* Base64 Mode Result */}
                    <div className="flex items-center gap-2">
                      {aiConfig.attachmentTest.base64Mode?.success ? (
                        <Check className="size-4 text-green-600 dark:text-green-400" />
                      ) : (
                        <AlertTriangle className="size-4 text-amber-500" />
                      )}
                      <span>
                        {t('admin.setting.ai.wizard.attachmentTest.base64Mode')}:{' '}
                        {aiConfig.attachmentTest.base64Mode?.success
                          ? t('admin.setting.ai.wizard.attachmentTest.accessible')
                          : t('admin.setting.ai.wizard.attachmentTest.inaccessible')}
                      </span>
                    </div>
                    {/* Warning if URL mode not supported */}
                    {!aiConfig.attachmentTest.urlMode?.success &&
                      aiConfig.attachmentTest.base64Mode?.success && (
                        <div className="mt-2 flex items-start gap-2 rounded-md bg-amber-50 p-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                          <span className="text-xs">
                            {t('admin.setting.ai.wizard.attachmentTest.urlNotAccessibleWarning')}
                          </span>
                        </div>
                      )}
                    {/* Mode Switch */}
                    <div className="mt-3 flex items-center justify-between border-t pt-3">
                      <div>
                        <div className="text-sm font-medium">
                          {t('admin.setting.ai.wizard.attachmentTest.useBase64Mode')}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {t('admin.setting.ai.wizard.attachmentTest.base64ModeDescription')}
                        </div>
                      </div>
                      <Switch
                        checked={currentTransferMode === 'base64'}
                        onCheckedChange={handleTransferModeChange}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Continue Button */}
      <div className="flex justify-end">
        <Button onClick={onComplete} disabled={!canProceed}>
          {t('admin.setting.ai.wizard.saveAndContinue')}
        </Button>
      </div>
    </div>
  );
}
