'use client';

import { Check, ArrowUpRight, Database, Zap, AlertTriangle, RotateCw } from '@teable/icons';
import { findDuplicateProviderModel } from '@teable/openapi';
import type {
  ISettingVo,
  LLMProvider,
  IChatModelAbility,
  IImageModelAbility,
  IAIConfigVo,
  IAttachmentTestResult,
  ITestLLMRo,
} from '@teable/openapi';
import { Button, Input, Label, cn, Switch } from '@teable/ui-lib/shadcn';
import Link from 'next/link';
import { useTranslation } from 'next-i18next';
import type { ReactNode } from 'react';
import { useState, useCallback, useMemo, useEffect, useId } from 'react';
import type { Control } from 'react-hook-form';
import { useEnv } from '@/features/app/hooks/useEnv';
import { AIProviderCard } from './AIProviderCard';
import type { LLMApiMode } from './AISetupWizard';
import { BatchTestModels } from './BatchTestModels';
import type { IModelTestResult } from './LlmproviderManage';
import { generateModelKeyList } from './utils';

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
  control: Control<IAIConfigVo>;
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
  onSave?: () => Promise<void>;
  isSaving?: boolean;
  isDirty?: boolean;
  hasClearedProviders?: boolean;
  onResetGateway?: () => void;
  /** Rendered at the start of the step's action row (e.g. an enterprise model catalog tool). */
  footerExtension?: ReactNode;
}

// eslint-disable-next-line sonarjs/cognitive-complexity
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
  onSave,
  isSaving,
  isDirty,
  hasClearedProviders,
  onResetGateway,
  footerExtension,
}: ILLMApiConfigStepProps) {
  const { t } = useTranslation('common');
  const { publicOrigin } = useEnv();
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [testErrorMessage, setTestErrorMessage] = useState<string | null>(null);
  const [attachmentTestResult, setAttachmentTestResult] = useState<IAttachmentTestResult | null>(
    null
  );

  // Local state for gateway fields — only persisted after a successful test
  const [localGatewayKey, setLocalGatewayKey] = useState(aiConfig?.aiGatewayApiKey || '');
  const [localGatewayBaseUrl, setLocalGatewayBaseUrl] = useState(aiConfig?.aiGatewayBaseUrl || '');

  useEffect(() => {
    setLocalGatewayKey(aiConfig?.aiGatewayApiKey || '');
  }, [aiConfig?.aiGatewayApiKey]);

  useEffect(() => {
    setLocalGatewayBaseUrl(aiConfig?.aiGatewayBaseUrl || '');
  }, [aiConfig?.aiGatewayBaseUrl]);

  const hasLocalGatewayKey = Boolean(localGatewayKey);
  const hasProviders = llmProviders.length > 0;
  const savedGatewayKey = aiConfig?.aiGatewayApiKey || '';
  const savedGatewayBaseUrl = aiConfig?.aiGatewayBaseUrl || '';
  const isCurrentGatewayConfig =
    localGatewayKey === savedGatewayKey && localGatewayBaseUrl === savedGatewayBaseUrl;

  const isGatewayKeyVerified =
    testResult === 'success' ||
    (testResult !== 'error' && Boolean(savedGatewayKey) && isCurrentGatewayConfig);

  const canProceed =
    (mode === 'gateway'
      ? isGatewayKeyVerified || !localGatewayKey
      : hasProviders || Boolean(hasClearedProviders)) && !findDuplicateProviderModel(llmProviders);

  // Get saved attachment test from aiConfig
  const savedAttachmentTest = useMemo(() => aiConfig?.attachmentTest, [aiConfig?.attachmentTest]);
  const currentTransferMode = aiConfig?.attachmentTransferMode || 'url';

  // Check if PUBLIC_ORIGIN has changed since last test
  const originChanged = useMemo(() => {
    const testedOrigin = savedAttachmentTest?.testedOrigin;
    if (!testedOrigin || !publicOrigin) return false;
    return testedOrigin !== publicOrigin;
  }, [savedAttachmentTest?.testedOrigin, publicOrigin]);

  const handleClearGatewayKey = useCallback(() => {
    setLocalGatewayKey('');
    setLocalGatewayBaseUrl('');
    setTestResult(null);
    setTestErrorMessage(null);
    setAttachmentTestResult(null);
    onResetGateway?.();
  }, [onResetGateway]);

  const handleTestGateway = useCallback(async () => {
    if (!localGatewayKey) return;

    setIsTesting(true);
    setTestResult(null);
    setTestErrorMessage(null);
    setAttachmentTestResult(null);

    try {
      const { testApiKey } = await import('@teable/openapi');
      const result = await testApiKey({
        type: 'aiGateway',
        apiKey: localGatewayKey,
        baseUrl: localGatewayBaseUrl || undefined,
        testAttachment: true,
      });

      if (result.success) {
        setTestResult('success');
        const updates: Partial<NonNullable<ISettingVo['aiConfig']>> = {
          aiGatewayApiKey: localGatewayKey,
          aiGatewayBaseUrl: localGatewayBaseUrl || undefined,
        };
        if (result.attachmentTest) {
          setAttachmentTestResult(result.attachmentTest);
          updates.attachmentTest = result.attachmentTest;
          if (
            !result.attachmentTest.urlMode?.success &&
            result.attachmentTest.base64Mode?.success
          ) {
            updates.attachmentTransferMode = 'base64';
          }
        }
        onAiConfigChange?.(updates);
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
  }, [localGatewayKey, localGatewayBaseUrl, onAiConfigChange, t]);

  // Handle manual mode switch
  const handleTransferModeChange = useCallback(
    (useBase64: boolean) => {
      const newMode = useBase64 ? 'base64' : 'url';
      onAiConfigChange?.({ attachmentTransferMode: newMode });
    },
    [onAiConfigChange]
  );

  // Determine the effective attachment test result (from current test or saved)
  const effectiveAttachmentTest = attachmentTestResult || savedAttachmentTest;

  const handleTest = async (data: ITestLLMRo) => {
    const { testLLM } = await import('@teable/openapi');
    return testLLM(data);
  };

  // What each option already has, shown on its tile so the other mode's setup stays visible.
  const gatewayConfigured = Boolean(aiConfig?.aiGatewayApiKey);
  const enabledGatewayModels = aiConfig?.gatewayModels?.filter((m) => m.enabled).length ?? 0;
  const customModelCount = useMemo(() => generateModelKeyList(llmProviders).length, [llmProviders]);

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
          {gatewayConfigured && (
            <p className="mt-2 flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
              <Check className="size-3.5 shrink-0" />
              {enabledGatewayModels > 0
                ? t('admin.setting.ai.guide.gatewayModelsConfigured', {
                    count: enabledGatewayModels,
                  })
                : t('admin.setting.ai.guide.gatewayKeyConfigured')}
            </p>
          )}
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
                'flex size-8 shrink-0 items-center justify-center rounded-lg',
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
          {llmProviders.length > 0 && (
            <p className="mt-2 flex items-center gap-1 text-xs text-green-700 dark:text-green-400">
              <Check className="size-3.5 shrink-0" />
              {t('admin.setting.ai.guide.providersConfigured', { count: llmProviders.length })}
              {' · '}
              {t('admin.setting.ai.wizard.modelsCount', { count: customModelCount })}
            </p>
          )}
        </div>
      </div>

      {/* Gateway Configuration */}
      {mode === 'gateway' && (
        <div className="space-y-4">
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
              <Button variant="outline" size="xs" asChild className="h-6 gap-1">
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
                value={localGatewayKey}
                placeholder={t('admin.action.enterApiKey')}
                onChange={(e) => {
                  const value = e.target.value?.trim() || '';
                  setLocalGatewayKey(value);
                  setTestResult(null);
                  if (!value) {
                    onResetGateway?.();
                  }
                }}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                onClick={handleTestGateway}
                disabled={!hasLocalGatewayKey || isTesting}
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
            {hasLocalGatewayKey && !testResult && (
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
              <AttachmentTestPanel
                className="mt-3"
                test={effectiveAttachmentTest}
                useBase64={currentTransferMode === 'base64'}
                onUseBase64Change={handleTransferModeChange}
                disabled={isSaving}
              />
            )}
          </div>

          {/* Base URL (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="gateway-url">
              {t('admin.setting.app.aiGatewayBaseUrl')}
              <span className="ms-1 text-xs text-muted-foreground">
                ({t('admin.setting.ai.wizard.optional')})
              </span>
            </Label>
            <Input
              id="gateway-url"
              type="text"
              value={localGatewayBaseUrl}
              placeholder="https://ai-gateway.vercel.sh/v1"
              onChange={(e) => {
                setLocalGatewayBaseUrl(e.target.value?.trim() || '');
                setTestResult(null);
              }}
            />
          </div>
        </div>
      )}

      {/* Custom Provider Configuration */}
      {mode === 'custom' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="min-w-0 flex-[1_1_16rem] text-sm text-muted-foreground">
              {t('admin.setting.ai.wizard.customProviderHelp')}
            </p>
            {llmProviders.length > 0 && (
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
            )}
          </div>

          <AIProviderCard
            variant="plain"
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
            onSaveTestResult={onSaveTestResult}
          />

          {llmProviders.length > 0 && aiConfig?.attachmentTest && (
            <AttachmentTestPanel
              test={aiConfig.attachmentTest}
              useBase64={currentTransferMode === 'base64'}
              onUseBase64Change={handleTransferModeChange}
              disabled={isSaving}
            />
          )}
        </div>
      )}

      {/* Step actions */}
      <div className="flex items-center justify-between gap-2">
        <div>{footerExtension}</div>
        <div className="flex justify-end gap-2">
          {mode === 'gateway' && Boolean(aiConfig?.aiGatewayApiKey) && (
            <Button type="button" variant="outline" onClick={handleClearGatewayKey}>
              <RotateCw className="me-1.5 size-3.5" />
              {t('email.resetConfig')}
            </Button>
          )}
          <Button
            type="button"
            onClick={async () => {
              if (isDirty) {
                await onSave?.();
              }
              onComplete?.();
            }}
            disabled={!canProceed || isSaving}
          >
            {isDirty ? t('admin.setting.ai.wizard.saveAndContinue') : t('actions.continue')}
          </Button>
        </div>
      </div>
    </div>
  );
}

interface IAttachmentTestPanelProps {
  test: Pick<IAttachmentTestResult, 'urlMode' | 'base64Mode'>;
  useBase64: boolean;
  onUseBase64Change: (useBase64: boolean) => void;
  disabled?: boolean;
  className?: string;
}

const AttachmentTestPanel = ({
  test,
  useBase64,
  onUseBase64Change,
  disabled,
  className,
}: IAttachmentTestPanelProps) => {
  const { t } = useTranslation('common');
  const switchId = useId();
  const modes = [
    {
      key: 'urlMode',
      label: t('admin.setting.ai.wizard.attachmentTest.urlMode'),
      ok: test.urlMode?.success,
    },
    {
      key: 'base64Mode',
      label: t('admin.setting.ai.wizard.attachmentTest.base64Mode'),
      ok: test.base64Mode?.success,
    },
  ];

  return (
    <div className={cn('space-y-2 rounded-md bg-muted/50 px-3 py-2.5', className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-[1_1_16rem] space-y-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">{t('admin.setting.ai.wizard.attachmentTest.title')}</span>
            {modes.map(({ key, label, ok }) => (
              <span key={key} className="flex items-center gap-1 text-muted-foreground">
                {ok ? (
                  <Check className="size-3.5 text-green-600 dark:text-green-400" />
                ) : (
                  <AlertTriangle className="size-3.5 text-amber-500" />
                )}
                {label}:{' '}
                {ok
                  ? t('admin.setting.ai.wizard.attachmentTest.accessible')
                  : t('admin.setting.ai.wizard.attachmentTest.inaccessible')}
              </span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('admin.setting.ai.wizard.attachmentTest.base64ModeDescription')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Label htmlFor={switchId} className="cursor-pointer text-sm font-normal">
            {t('admin.setting.ai.wizard.attachmentTest.useBase64Mode')}
          </Label>
          <Switch
            id={switchId}
            checked={useBase64}
            onCheckedChange={onUseBase64Change}
            disabled={disabled}
          />
        </div>
      </div>
      {!test.urlMode?.success && test.base64Mode?.success && (
        <div className="flex items-start gap-2 rounded-md bg-amber-50 p-2 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="text-xs">
            {t('admin.setting.ai.wizard.attachmentTest.urlNotAccessibleWarning')}
          </span>
        </div>
      )}
    </div>
  );
};
