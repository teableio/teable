/* eslint-disable @typescript-eslint/no-unused-vars */
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Check, Loader2, Plus, X, Eye, Image } from '@teable/icons';
import { llmProviderSchema, LLMProviderType, chatModelAbilityType } from '@teable/openapi';
import type {
  ITestLLMVo,
  ITestLLMRo,
  LLMProvider,
  IModelConfig,
  IChatModelAbility,
  IImageModelAbility,
} from '@teable/openapi';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { ChevronDown, ChevronUp, Square } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { PropsWithChildren } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useIsCloud } from '@/features/app/hooks/useIsCloud';
import { LLM_PROVIDERS } from './constant';

interface TestResult {
  success: boolean;
  message?: string;
  suggestions?: string[];
}

// Model test result interface for full capability testing
interface IModelTestStatus {
  model: string;
  status: 'idle' | 'pending' | 'testing' | 'success' | 'failed';
  error?: string;
  ability?: IChatModelAbility;
  imageAbility?: IImageModelAbility;
  isImageModel?: boolean;
}

const TEXT_MODEL_TIMEOUT_MS = 30000; // 30 seconds timeout for text models
const IMAGE_MODEL_TIMEOUT_MS = 120000; // 2 minutes timeout for image models
const CONCURRENCY = 3; // Concurrent test count

// Helper to wrap promise with timeout
const withTimeout = <T,>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms)),
  ]);
};

type ErrorPattern = {
  keywords: string[];
  suggestion: string;
  condition?: (ctx: { type: LLMProviderType; lowerUrl: string }) => boolean;
};

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    keywords: ['401', 'unauthorized', 'invalid api key', 'authentication'],
    suggestion: 'hint.checkApiKey',
  },
  {
    keywords: ['401', 'unauthorized'],
    suggestion: 'hint.azureDeployment',
    condition: ({ type }) => type === LLMProviderType.AZURE,
  },
  {
    keywords: ['403', 'forbidden', 'quota', 'rate limit'],
    suggestion: 'hint.checkQuotaOrPermission',
  },
  {
    keywords: ['econnrefused', 'enotfound', 'timeout', 'network'],
    suggestion: 'hint.checkConnection',
  },
  {
    keywords: ['econnrefused', 'enotfound'],
    suggestion: 'hint.ollamaRunning',
    condition: ({ type }) => type === LLMProviderType.OLLAMA,
  },
  {
    keywords: ['ssl', 'certificate'],
    suggestion: 'hint.sslCertificate',
  },
];

function matchesKeywords(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

function checkMissingV1Suffix(
  lowerError: string,
  lowerUrl: string,
  type: LLMProviderType
): string | null {
  const is404 = matchesKeywords(lowerError, ['404', 'not found', 'invalid url']);
  const hasV1 = lowerUrl.endsWith('/v1') || lowerUrl.endsWith('/v1/');
  const needsV1 = type !== LLMProviderType.OLLAMA && type !== LLMProviderType.GOOGLE;
  if (!is404 || hasV1 || !needsV1) return null;

  const placeholder = LLM_PROVIDERS.find((p) => p.value === type)?.baseUrlPlaceholder;
  return placeholder?.includes('/v1') ? 'hint.missingV1Suffix' : null;
}

function analyzeError(
  error: string,
  baseUrl: string,
  type: LLMProviderType
): { message: string; suggestions: string[] } {
  const suggestions: string[] = [];
  const lowerError = error.toLowerCase();
  const lowerUrl = baseUrl.toLowerCase();
  const ctx = { type, lowerUrl };

  // Check for missing /v1 suffix
  const v1Hint = checkMissingV1Suffix(lowerError, lowerUrl, type);
  if (v1Hint) suggestions.push(v1Hint);

  // Check for trailing slash
  if (lowerUrl.endsWith('/') && lowerError.includes('404')) {
    suggestions.push('hint.removeTrailingSlash');
  }

  // Check model not found
  const isModelNotFound =
    lowerError.includes('model') &&
    (lowerError.includes('not found') || lowerError.includes('does not exist'));
  if (isModelNotFound) suggestions.push('hint.checkModelName');

  // Match other patterns
  for (const pattern of ERROR_PATTERNS) {
    const matches = matchesKeywords(lowerError, pattern.keywords);
    const conditionMet = !pattern.condition || pattern.condition(ctx);
    if (matches && conditionMet && !suggestions.includes(pattern.suggestion)) {
      suggestions.push(pattern.suggestion);
    }
  }

  // Fallback
  if (suggestions.length === 0) suggestions.push('hint.checkConfiguration');

  return { message: error, suggestions };
}

interface LLMProviderFormProps {
  value?: LLMProvider;
  onChange?: (value: LLMProvider) => void;
  onAdd?: (data: LLMProvider) => void;
  /** Test function - accepts full ITestLLMRo for capability testing */
  onTest?: (data: ITestLLMRo) => Promise<ITestLLMVo>;
  /** Hide model rates config (for space-level settings where billing doesn't apply) */
  hideModelRates?: boolean;
  /** Callback to save model test results */
  onSaveTestResult?: (
    modelKey: string,
    ability: IChatModelAbility | undefined,
    imageAbility: IImageModelAbility | undefined
  ) => void;
}

export const UpdateLLMProviderForm = ({
  value,
  children,
  onChange,
  onTest,
  hideModelRates,
  onSaveTestResult,
}: PropsWithChildren<Omit<LLMProviderFormProps, 'onAdd'>>) => {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation('common');
  const handleChange = (data: LLMProvider) => {
    onChange?.(data);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('admin.setting.ai.updateLLMProvider')}</DialogTitle>
        </DialogHeader>
        <LLMProviderForm
          value={value}
          onChange={handleChange}
          onTest={onTest}
          hideModelRates={hideModelRates}
          onSaveTestResult={onSaveTestResult}
        />
      </DialogContent>
    </Dialog>
  );
};

export const NewLLMProviderForm = ({
  children,
  onAdd,
  onTest,
  hideModelRates,
  onSaveTestResult,
}: PropsWithChildren<Omit<LLMProviderFormProps, 'onChange'>>) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const handleAdd = (data: LLMProvider) => {
    onAdd?.(data);
    setOpen(false);
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children ?? (
          <Button size="sm" variant="outline" className="w-fit gap-2">
            <Plus className="size-4" />
            {t('admin.setting.ai.addProvider')}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>{t('admin.setting.ai.addProvider')}</DialogTitle>
          <DialogDescription>{t('admin.setting.ai.addProviderDescription')}</DialogDescription>
        </DialogHeader>
        <LLMProviderForm
          onAdd={handleAdd}
          onTest={onTest}
          hideModelRates={hideModelRates}
          onSaveTestResult={onSaveTestResult}
        />
      </DialogContent>
    </Dialog>
  );
};

// Rate field keys for model configuration
type RateFieldKey =
  | 'inputRate'
  | 'outputRate'
  | 'cacheReadRate'
  | 'cacheWriteRate'
  | 'reasoningRate'
  | 'imageRate';

// Component for configuring rates per model
interface ModelRatesConfigProps {
  models: string;
  modelConfigs: Record<string, IModelConfig> | undefined;
  onChange: (configs: Record<string, IModelConfig>) => void;
}

const ModelRatesConfig = ({ models, modelConfigs = {}, onChange }: ModelRatesConfigProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const modelList = useMemo(() => {
    return models
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
  }, [models]);

  if (modelList.length === 0) return null;

  const handleRateChange = (model: string, field: RateFieldKey, value: string) => {
    const numValue = value === '' ? undefined : parseFloat(value) || 0;
    const currentConfig = modelConfigs[model] || {};
    onChange({
      ...modelConfigs,
      [model]: {
        ...currentConfig,
        [field]: numValue,
      },
    });
  };

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        {t('admin.setting.ai.modelRates')} ({modelList.length})
      </button>

      {expanded && (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          {/* Rate explanation */}
          <div className="rounded bg-blue-50 p-2 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-200">
            <div className="font-medium">{t('admin.setting.ai.rateExplanationTitle')}</div>
            <div className="mt-1 space-y-0.5 text-[11px] opacity-90">
              <div>• {t('admin.setting.ai.rateExplanationFormula')}</div>
              <div>• {t('admin.setting.ai.rateExplanationExample')}</div>
            </div>
          </div>

          {/* Basic rates */}
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr,80px,80px] gap-2 text-xs font-medium text-muted-foreground">
              <div>{t('admin.setting.ai.model')}</div>
              <div title={t('admin.setting.ai.inputRateTip')}>
                {t('admin.setting.ai.inputRate')}
              </div>
              <div title={t('admin.setting.ai.outputRateTip')}>
                {t('admin.setting.ai.outputRate')}
              </div>
            </div>
            {modelList.map((model) => {
              const config = modelConfigs[model] || {};
              return (
                <div key={model} className="grid grid-cols-[1fr,80px,80px] items-center gap-2">
                  <div className="truncate text-sm" title={model}>
                    {model}
                  </div>
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={config.inputRate ?? ''}
                    onChange={(e) => handleRateChange(model, 'inputRate', e.target.value)}
                    placeholder="0"
                    className="h-7 text-xs"
                  />
                  <Input
                    type="number"
                    step="0.0001"
                    min="0"
                    value={config.outputRate ?? ''}
                    onChange={(e) => handleRateChange(model, 'outputRate', e.target.value)}
                    placeholder="0"
                    className="h-7 text-xs"
                  />
                </div>
              );
            })}
          </div>

          {/* Advanced rates toggle */}
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showAdvanced ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {t('admin.setting.ai.advancedRates')}
          </button>

          {/* Advanced rates (cache, reasoning, image) */}
          {showAdvanced && (
            <div className="space-y-2 rounded border bg-background/50 p-2">
              <div className="grid grid-cols-[1fr,70px,70px,70px,70px] gap-1 text-[10px] font-medium text-muted-foreground">
                <div>{t('admin.setting.ai.model')}</div>
                <div title={t('admin.setting.ai.cacheReadRateTip')}>
                  {t('admin.setting.ai.cacheRead')}
                </div>
                <div title={t('admin.setting.ai.cacheWriteRateTip')}>
                  {t('admin.setting.ai.cacheWrite')}
                </div>
                <div title={t('admin.setting.ai.reasoningRateTip')}>
                  {t('admin.setting.ai.reasoning')}
                </div>
                <div title={t('admin.setting.ai.imageRateTip')}>
                  {t('admin.setting.ai.perImage')}
                </div>
              </div>
              {modelList.map((model) => {
                const config = modelConfigs[model] || {};
                return (
                  <div
                    key={`adv-${model}`}
                    className="grid grid-cols-[1fr,70px,70px,70px,70px] items-center gap-1"
                  >
                    <div className="truncate text-xs" title={model}>
                      {model}
                    </div>
                    <Input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={config.cacheReadRate ?? ''}
                      onChange={(e) => handleRateChange(model, 'cacheReadRate', e.target.value)}
                      placeholder="auto"
                      className="h-6 text-[10px]"
                    />
                    <Input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={config.cacheWriteRate ?? ''}
                      onChange={(e) => handleRateChange(model, 'cacheWriteRate', e.target.value)}
                      placeholder="auto"
                      className="h-6 text-[10px]"
                    />
                    <Input
                      type="number"
                      step="0.0001"
                      min="0"
                      value={config.reasoningRate ?? ''}
                      onChange={(e) => handleRateChange(model, 'reasoningRate', e.target.value)}
                      placeholder="auto"
                      className="h-6 text-[10px]"
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={config.imageRate ?? ''}
                      onChange={(e) => handleRateChange(model, 'imageRate', e.target.value)}
                      placeholder="0"
                      className="h-6 text-[10px]"
                    />
                  </div>
                );
              })}
              <p className="text-[10px] text-muted-foreground">
                {t('admin.setting.ai.advancedRatesDescription')}
              </p>
            </div>
          )}

          <p className="text-xs text-muted-foreground">{t('admin.setting.ai.ratesDescription')}</p>
        </div>
      )}
    </div>
  );
};

export const LLMProviderForm = ({
  value,
  onAdd,
  onChange,
  onTest,
  hideModelRates,
  onSaveTestResult,
}: LLMProviderFormProps) => {
  const { t } = useTranslation();
  const isCloud = useIsCloud();
  const [isTestLoading, setIsTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testPassed, setTestPassed] = useState(false);
  const [modelTestStatuses, setModelTestStatuses] = useState<IModelTestStatus[]>([]);
  const [testProgress, setTestProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef(false);

  const form = useForm<LLMProvider>({
    resolver: zodResolver(llmProviderSchema),
    defaultValues: value || {
      name: '',
      type: LLMProviderType.OPENAI,
      apiKey: '',
      baseUrl: '',
      models: '',
      modelConfigs: {},
    },
  });

  // Clear test result when form values change
  const baseUrl = form.watch('baseUrl');
  const apiKey = form.watch('apiKey');
  const models = form.watch('models');
  const formType = form.watch('type');
  useEffect(() => {
    setTestResult(null);
    setTestPassed(false);
    setModelTestStatuses([]);
    setTestProgress({ current: 0, total: 0 });
  }, [baseUrl, apiKey, models, formType]);

  function onSubmit(data: LLMProvider) {
    onChange ? onChange(data) : onAdd?.(data);
  }

  function handleSubmit() {
    const data = form.getValues();
    onSubmit(data);
  }

  // Test a single text model
  const testTextModel = useCallback(
    async (model: string, provider: Required<LLMProvider>): Promise<Partial<IModelTestStatus>> => {
      if (!onTest) {
        return { status: 'failed', error: 'Test function not provided' };
      }
      try {
        const { type, name, apiKey, baseUrl, models } = provider;
        const modelKey = `${type}@${model}@${name}`;

        const result = await withTimeout(
          onTest({
            type,
            name,
            apiKey,
            baseUrl,
            models,
            modelKey,
            // Test all chat model abilities
            ability: chatModelAbilityType.options,
          }),
          TEXT_MODEL_TIMEOUT_MS,
          `Timeout after ${TEXT_MODEL_TIMEOUT_MS / 1000}s`
        );

        if (!result.success) {
          return {
            status: 'failed',
            error: result.response || 'Test failed',
          };
        }

        return {
          status: 'success',
          ability: result.ability,
        };
      } catch (error) {
        return {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    [onTest]
  );

  // Test a single image model
  const testImageModel = useCallback(
    async (model: string, provider: Required<LLMProvider>): Promise<Partial<IModelTestStatus>> => {
      if (!onTest) {
        return { status: 'failed', error: 'Test function not provided', isImageModel: true };
      }
      try {
        const { type, name, apiKey, baseUrl, models } = provider;
        const modelKey = `${type}@${model}@${name}`;

        // Test image generation (text-to-image)
        const generationResult = await withTimeout(
          onTest({
            type,
            name,
            apiKey,
            baseUrl,
            models,
            modelKey,
            testImageGeneration: true,
          }),
          IMAGE_MODEL_TIMEOUT_MS,
          `Timeout after ${IMAGE_MODEL_TIMEOUT_MS / 1000}s`
        );

        // Test image-to-image if generation works
        let imageToImage = false;
        if (generationResult.success) {
          try {
            const i2iResult = await withTimeout(
              onTest({
                type,
                name,
                apiKey,
                baseUrl,
                models,
                modelKey,
                testImageGeneration: true,
                testImageToImage: true,
              }),
              IMAGE_MODEL_TIMEOUT_MS,
              `Timeout`
            );
            imageToImage = i2iResult.success;
          } catch {
            // Image-to-image not supported, that's ok
          }
        }

        if (!generationResult.success) {
          return {
            status: 'failed',
            error: generationResult.response || 'Image generation test failed',
            isImageModel: true,
          };
        }

        return {
          status: 'success',
          isImageModel: true,
          imageAbility: {
            generation: true,
            imageToImage,
          },
        };
      } catch (error) {
        return {
          status: 'failed',
          isImageModel: true,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    },
    [onTest]
  );

  // Full capability test for all models
  const handleFullTest = useCallback(async () => {
    const formData = form.getValues();
    setTestResult(null);

    // Validate required fields
    if (
      !formData.name ||
      !formData.type ||
      !formData.baseUrl ||
      (!formData.apiKey && formData.type !== LLMProviderType.OLLAMA)
    ) {
      setTestResult({
        success: false,
        message: t('admin.setting.ai.fillRequiredFields'),
      });
      return;
    }

    if (!formData.models) {
      setTestResult({
        success: false,
        message: t('admin.setting.ai.modelsRequired'),
      });
      return;
    }

    const modelList = formData.models
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    if (modelList.length === 0) {
      setTestResult({
        success: false,
        message: t('admin.setting.ai.noValidModel'),
      });
      return;
    }

    // Initialize test state
    abortRef.current = false;
    setIsTestLoading(true);
    setTestPassed(false);
    setTestProgress({ current: 0, total: modelList.length });

    // Initialize all models as pending
    const initialStatuses: IModelTestStatus[] = modelList.map((model) => ({
      model,
      status: 'pending',
      isImageModel: formData.modelConfigs?.[model]?.isImageModel,
    }));
    setModelTestStatuses(initialStatuses);

    const provider = formData as Required<LLMProvider>;
    let completedCount = 0;
    let successCount = 0;
    let nextIndex = 0;

    const updateModelStatus = (model: string, update: Partial<IModelTestStatus>) => {
      setModelTestStatuses((prev) =>
        prev.map((s) => (s.model === model ? { ...s, ...update } : s))
      );
    };

    const startNextTest = async () => {
      if (abortRef.current || nextIndex >= modelList.length) return;

      const currentIndex = nextIndex++;
      const model = modelList[currentIndex];
      const isImageModel = formData.modelConfigs?.[model]?.isImageModel;

      updateModelStatus(model, { status: 'testing' });

      const result = isImageModel
        ? await testImageModel(model, provider)
        : await testTextModel(model, provider);

      updateModelStatus(model, result);
      completedCount++;
      if (result.status === 'success') {
        successCount++;
        // Save test result to provider config
        const modelKey = `${provider.type}@${model}@${provider.name}`;
        onSaveTestResult?.(modelKey, result.ability, result.imageAbility);
      }
      setTestProgress({ current: completedCount, total: modelList.length });

      // Start next test if there are more
      if (!abortRef.current && nextIndex < modelList.length) {
        await startNextTest();
      }
    };

    // Start concurrent tests
    const initialPromises: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, modelList.length); i++) {
      initialPromises.push(startNextTest());
    }

    await Promise.all(initialPromises);

    setIsTestLoading(false);

    // Check results
    if (successCount > 0) {
      setTestPassed(true);
      toast.success(
        t('admin.setting.ai.testCompleteWithCount', {
          success: successCount,
          total: modelList.length,
        })
      );
    } else {
      setTestResult({
        success: false,
        message: t('admin.setting.ai.allTestsFailed'),
      });
    }
  }, [form, t, testTextModel, testImageModel, onSaveTestResult]);

  const handleStopTest = useCallback(() => {
    abortRef.current = true;
    setIsTestLoading(false);
  }, []);

  const mode = onChange ? t('actions.update') : t('actions.add');
  const type = form.watch('type');
  const currentProvider = LLM_PROVIDERS.find(
    (provider) => provider.value === type
  ) as (typeof LLM_PROVIDERS)[number] & { apiKeyPlaceholder?: string };

  // Calculate test statistics
  const successCount = modelTestStatuses.filter((s) => s.status === 'success').length;
  const failedCount = modelTestStatuses.filter((s) => s.status === 'failed').length;
  const progressPercent =
    testProgress.total > 0 ? Math.round((testProgress.current / testProgress.total) * 100) : 0;

  return (
    <Form {...form}>
      <FormField
        name="name"
        render={({ field }) => (
          <FormItem>
            <div>
              <FormLabel>{t('admin.setting.ai.name')}</FormLabel>
              <FormDescription>{t('admin.setting.ai.nameDescription')}</FormDescription>
            </div>
            <FormControl>
              <Input {...field} autoComplete="off" placeholder="openai/claude/gemini..." />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        name="type"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t('admin.setting.ai.providerType')}</FormLabel>
            <FormControl>
              <Select
                {...field}
                onValueChange={(value) => {
                  form.setValue('type', value as unknown as LLMProvider['type']);
                }}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t('admin.setting.ai.providerType')} />
                </SelectTrigger>
                <SelectContent>
                  {LLM_PROVIDERS.map(({ value, label, Icon }) => (
                    <SelectItem key={value} value={value}>
                      <div className="flex flex-row items-center text-[13px]">
                        <Icon className="size-5 shrink-0 pr-1" />
                        {label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {!!currentProvider && (
        <>
          <FormField
            name="baseUrl"
            render={({ field }) => (
              <FormItem>
                <div>
                  <FormLabel>{t('admin.setting.ai.baseUrl')}</FormLabel>
                  <FormDescription>{t('admin.setting.ai.baseUrlDescription')}</FormDescription>
                </div>
                <FormControl>
                  <Input {...field} placeholder={currentProvider.baseUrlPlaceholder} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          {type !== LLMProviderType.OLLAMA && (
            <FormField
              name="apiKey"
              render={({ field }) => (
                <FormItem>
                  <div>
                    <FormLabel>{t('admin.setting.ai.apiKey')}</FormLabel>
                    <FormDescription>{t('admin.setting.ai.apiKeyDescription')}</FormDescription>
                  </div>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      placeholder={currentProvider?.apiKeyPlaceholder ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          )}
          <FormField
            name="models"
            render={({ field }) => (
              <FormItem>
                <div>
                  <FormLabel>{t('admin.setting.ai.models')}</FormLabel>
                  <FormDescription>{t('admin.setting.ai.modelsDescription')}</FormDescription>
                </div>
                <FormControl>
                  <Input {...field} placeholder={currentProvider.modelsPlaceholder} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Model Rates Configuration (Cloud only - for billing, hidden in space settings) */}
          {isCloud && !hideModelRates && (
            <ModelRatesConfig
              models={form.watch('models') || ''}
              modelConfigs={form.watch('modelConfigs')}
              onChange={(configs) => form.setValue('modelConfigs', configs)}
            />
          )}

          {/* Test Error Display */}
          {testResult && !testResult.success && (
            <div className="space-y-2 rounded-md border bg-muted p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="mt-0.5 size-4 shrink-0" />
                <p className="break-all font-medium">{testResult.message}</p>
              </div>
              {testResult.suggestions && testResult.suggestions.length > 0 && (
                <div className="text-muted-foreground">
                  {testResult.suggestions.map((suggestion, index) => {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const key = `admin.setting.ai.${suggestion}` as any;
                    return (
                      <p key={index} className="text-xs">
                        💡 {t(key)}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Test Progress Display */}
          {modelTestStatuses.length > 0 && (
            <div className="space-y-3 rounded-md border bg-muted p-3">
              {/* Progress bar */}
              {testProgress.total > 0 && (
                <div className="flex items-center gap-3">
                  <Progress value={progressPercent} className="h-1.5 flex-1" />
                  <div className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                    {isTestLoading && <Loader2 className="size-3 animate-spin" />}
                    <span>{progressPercent}%</span>
                    <span className="text-green-600 dark:text-green-400">{successCount} ✓</span>
                    <span className="text-red-600 dark:text-red-400">{failedCount} ✗</span>
                  </div>
                </div>
              )}
              {/* Model test results */}
              <div className="flex flex-wrap gap-2">
                {modelTestStatuses.map((status) => (
                  <ModelTestPill key={status.model} status={status} />
                ))}
              </div>
            </div>
          )}

          <div className="flex w-full flex-row gap-2">
            {onTest && (
              <>
                {isTestLoading ? (
                  <Button
                    className="flex-1"
                    onClick={handleStopTest}
                    type="button"
                    variant="destructive"
                  >
                    <Square className="mr-1 size-3" />
                    {t('admin.setting.ai.stopTest')}
                  </Button>
                ) : (
                  <Button
                    className="flex-1"
                    onClick={handleFullTest}
                    disabled={isTestLoading}
                    type="button"
                    variant={testPassed ? 'outline' : 'default'}
                  >
                    {testPassed ? (
                      <>
                        <Check className="size-4 text-green-600" />
                        {t('admin.setting.ai.testSuccess')}
                      </>
                    ) : (
                      t('admin.setting.ai.testConnection')
                    )}
                  </Button>
                )}
              </>
            )}
            {testPassed && (
              <Button className="flex-1" onClick={handleSubmit}>
                {mode}
              </Button>
            )}
          </div>
        </>
      )}
    </Form>
  );
};

// Component for displaying individual model test status
interface IModelTestPillProps {
  status: IModelTestStatus;
}

const ModelTestPill = ({ status }: IModelTestPillProps) => {
  const { model, status: testStatus, error, ability, imageAbility, isImageModel } = status;

  const getStatusStyles = () => {
    switch (testStatus) {
      case 'idle':
        return 'bg-primary/5 text-muted-foreground border-transparent';
      case 'pending':
        return 'bg-primary/5 text-foreground border-transparent';
      case 'testing':
        return 'bg-blue-50 text-blue-600 border-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:border-blue-500/20';
      case 'success':
        return 'bg-green-50 text-green-600 border-green-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20';
      case 'failed':
        return 'bg-red-50 text-red-600 border-red-100 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20';
    }
  };

  // eslint-disable-next-line sonarjs/cognitive-complexity
  const getImageIcon = () => {
    if (testStatus !== 'success') return null;

    // For text models: show vision support
    if (!isImageModel && ability?.image) {
      const { url, base64 } = ability.image as { url?: boolean; base64?: boolean };
      if (url && base64) {
        return <Eye className="size-3 text-green-600 dark:text-green-400" />;
      }
      if (url || base64) {
        return <Eye className="size-3 text-yellow-600 dark:text-yellow-400" />;
      }
      return <Eye className="size-3 opacity-30" />;
    }

    // For image models: show generation support
    if (isImageModel && imageAbility) {
      const { generation, imageToImage } = imageAbility;
      if (generation && imageToImage) {
        return <Image className="size-3 text-green-600 dark:text-green-400" />;
      }
      if (generation || imageToImage) {
        return <Image className="size-3 text-yellow-600 dark:text-yellow-400" />;
      }
      return <Image className="size-3 opacity-30" />;
    }

    return null;
  };

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        getStatusStyles(),
        isImageModel && 'ring-1 ring-blue-200 dark:bg-blue-500/10 dark:ring-blue-500/20'
      )}
      title={error || model}
    >
      <span className="max-w-[100px] truncate">{model}</span>

      {/* Status indicator */}
      {testStatus === 'testing' && <Loader2 className="size-3 animate-spin" />}
      {testStatus === 'success' && <Check className="size-3" />}
      {testStatus === 'failed' && <X className="size-3" />}

      {/* Image support indicator */}
      {getImageIcon()}
    </div>
  );
};
