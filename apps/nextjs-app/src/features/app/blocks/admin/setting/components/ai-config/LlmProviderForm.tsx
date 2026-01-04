/* eslint-disable @typescript-eslint/no-unused-vars */
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Check, Loader2, Plus } from '@teable/icons';
import type { ITestLLMVo, LLMProvider, IModelConfig } from '@teable/openapi/src/admin/setting';
import { llmProviderSchema, LLMProviderType } from '@teable/openapi/src/admin/setting';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@teable/ui-lib/shadcn';
import { toast } from '@teable/ui-lib/shadcn/ui/sonner';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from 'next-i18next';
import type { PropsWithChildren } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { LLM_PROVIDERS } from './constant';

interface TestResult {
  success: boolean;
  message?: string;
  suggestions?: string[];
}

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
  onTest?: (data: Required<LLMProvider>) => Promise<ITestLLMVo>;
}

export const UpdateLLMProviderForm = ({
  value,
  children,
  onChange,
  onTest,
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
        <LLMProviderForm value={value} onChange={handleChange} onTest={onTest} />
      </DialogContent>
    </Dialog>
  );
};

export const NewLLMProviderForm = ({
  children,
  onAdd,
  onTest,
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
          <Button size="sm" variant="outline" className="gap-2">
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
        <LLMProviderForm onAdd={handleAdd} onTest={onTest} />
      </DialogContent>
    </Dialog>
  );
};

// Component for configuring rates per model
interface ModelRatesConfigProps {
  models: string;
  modelConfigs: Record<string, IModelConfig> | undefined;
  onChange: (configs: Record<string, IModelConfig>) => void;
}

const ModelRatesConfig = ({ models, modelConfigs = {}, onChange }: ModelRatesConfigProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const modelList = useMemo(() => {
    return models
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
  }, [models]);

  if (modelList.length === 0) return null;

  const handleRateChange = (model: string, field: 'inputRate' | 'outputRate', value: string) => {
    const numValue = parseFloat(value) || 0;
    const currentConfig = modelConfigs[model] || { inputRate: 0, outputRate: 0 };
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
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <div className="grid grid-cols-[1fr,80px,80px] gap-2 text-xs font-medium text-muted-foreground">
            <div>{t('admin.setting.ai.model')}</div>
            <div>{t('admin.setting.ai.inputRate')}</div>
            <div>{t('admin.setting.ai.outputRate')}</div>
          </div>
          {modelList.map((model) => {
            const config = modelConfigs[model] || { inputRate: 0, outputRate: 0 };
            return (
              <div key={model} className="grid grid-cols-[1fr,80px,80px] items-center gap-2">
                <div className="truncate text-sm" title={model}>
                  {model}
                </div>
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={config.inputRate || ''}
                  onChange={(e) => handleRateChange(model, 'inputRate', e.target.value)}
                  placeholder="0"
                  className="h-7 text-xs"
                />
                <Input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={config.outputRate || ''}
                  onChange={(e) => handleRateChange(model, 'outputRate', e.target.value)}
                  placeholder="0"
                  className="h-7 text-xs"
                />
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">{t('admin.setting.ai.ratesDescription')}</p>
        </div>
      )}
    </div>
  );
};

export const LLMProviderForm = ({ value, onAdd, onChange, onTest }: LLMProviderFormProps) => {
  const { t } = useTranslation();
  const [isTestLoading, setIsTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testPassed, setTestPassed] = useState(false);

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
  }, [baseUrl, apiKey, models, formType]);

  function onSubmit(data: LLMProvider) {
    onChange ? onChange(data) : onAdd?.(data);
  }

  function handleSubmit() {
    const data = form.getValues();
    onSubmit(data);
  }

  async function handleTest() {
    if (!onTest) return;

    const formData = form.getValues();
    setTestResult(null);

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

    const firstModel = formData.models.split(',')[0]?.trim();

    if (!firstModel) {
      setTestResult({
        success: false,
        message: t('admin.setting.ai.noValidModel'),
      });
      return;
    }

    setIsTestLoading(true);

    try {
      const result = await onTest(formData as Required<LLMProvider>);
      const { success, response } = result;

      if (success) {
        setTestResult(null);
        setTestPassed(true);
        toast.success(t('admin.setting.ai.testSuccess'));
      } else {
        const analysis = analyzeError(
          response || 'Unknown error',
          formData.baseUrl || '',
          formData.type as LLMProviderType
        );
        setTestResult({
          success: false,
          message: analysis.message,
          suggestions: analysis.suggestions,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const analysis = analyzeError(
        errorMessage,
        formData.baseUrl || '',
        formData.type as LLMProviderType
      );
      setTestResult({
        success: false,
        message: analysis.message,
        suggestions: analysis.suggestions,
      });
    } finally {
      setIsTestLoading(false);
    }
  }

  const mode = onChange ? t('actions.update') : t('actions.add');
  const type = form.watch('type');
  const currentProvider = LLM_PROVIDERS.find(
    (provider) => provider.value === type
  ) as (typeof LLM_PROVIDERS)[number] & { apiKeyPlaceholder?: string };

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

          {/* Model Rates Configuration */}
          <ModelRatesConfig
            models={form.watch('models') || ''}
            modelConfigs={form.watch('modelConfigs')}
            onChange={(configs) => form.setValue('modelConfigs', configs)}
          />

          {/* Test Error Display */}
          {testResult && !testResult.success && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-sm">
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

          <div className="flex w-full flex-row gap-2">
            {onTest && (
              <Button
                className="flex-1"
                onClick={handleTest}
                disabled={isTestLoading}
                type="button"
                variant={testPassed ? 'outline' : 'default'}
              >
                {isTestLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {t('admin.setting.ai.testing')}
                  </>
                ) : testPassed ? (
                  <>
                    <Check className="size-4 text-green-600" />
                    {t('admin.setting.ai.testSuccess')}
                  </>
                ) : (
                  t('admin.setting.ai.testConnection')
                )}
              </Button>
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
