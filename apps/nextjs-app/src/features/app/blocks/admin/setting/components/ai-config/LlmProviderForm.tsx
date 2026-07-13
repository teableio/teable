/* eslint-disable @typescript-eslint/no-unused-vars */
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle,
  Check,
  Loader2,
  Pencil,
  Plus,
  X,
  Eye,
  Image,
  HelpCircle,
} from '@teable/icons';
import {
  getImageModelTagsFromAbility,
  llmProviderSchema,
  LLMProviderType,
  chatModelAbilityType,
  scalePricing,
} from '@teable/openapi';
import type {
  ITestLLMVo,
  ITestLLMRo,
  LLMProvider,
  IModelConfig,
  IChatModelAbility,
  IImageModelAbility,
  IModelPricing,
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
import { calculateMultiplier, formatMultiplier } from './ai-model-select/utils';
import { LLM_PROVIDERS } from './constant';
import { ModelSearchPopover } from './gateway-models-step/ModelSearchPopover';
import type { IGatewayModelAPI } from './gateway-models-step/types';
import { formatUsdPriceShort } from './gateway-models-step/utils';
import { testImageModelCapability, TEXT_MODEL_TIMEOUT_MS, withTimeout } from './model-test-utils';
import { useGatewayModelsQuery } from './useGatewayModelsQuery';
import { generateByokProviderName } from './utils';

const CUSTOM_MODEL_DOC_URL = 'https://help.teable.ai/en/basic/ai/custom-model';

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

const CONCURRENCY = 3; // Concurrent test count

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
  /** Hide pricing fields (space-level settings where billing doesn't apply); token caps stay editable */
  hideModelRates?: boolean;
  /** Callback to save model test results */
  onSaveTestResult?: (
    modelKey: string,
    ability: IChatModelAbility | undefined,
    imageAbility: IImageModelAbility | undefined
  ) => void;
  providerNameMode?: ProviderNameMode;
}

export type ProviderNameMode = 'manual' | 'auto';

export const UpdateLLMProviderForm = ({
  value,
  children,
  onChange,
  onTest,
  hideModelRates,
  onSaveTestResult,
  providerNameMode,
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
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('admin.setting.ai.updateLLMProvider')}
            <a href={CUSTOM_MODEL_DOC_URL} target="_blank" rel="noopener noreferrer">
              <HelpCircle className="size-4 text-muted-foreground hover:text-foreground" />
            </a>
          </DialogTitle>
        </DialogHeader>
        <div className="-mx-6 grid min-h-0 gap-4 overflow-y-auto px-6">
          <LLMProviderForm
            value={value}
            onChange={handleChange}
            onTest={onTest}
            hideModelRates={hideModelRates}
            onSaveTestResult={onSaveTestResult}
            providerNameMode={providerNameMode}
          />
        </div>
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
  providerNameMode,
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
      <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-[720px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t('admin.setting.ai.addProvider')}
            <a href={CUSTOM_MODEL_DOC_URL} target="_blank" rel="noopener noreferrer">
              <HelpCircle className="size-4 text-muted-foreground hover:text-foreground" />
            </a>
          </DialogTitle>
          <DialogDescription>{t('admin.setting.ai.addProviderDescription')}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 grid min-h-0 gap-4 overflow-y-auto px-6">
          <LLMProviderForm
            onAdd={handleAdd}
            onTest={onTest}
            hideModelRates={hideModelRates}
            onSaveTestResult={onSaveTestResult}
            providerNameMode={providerNameMode}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};

// Component for configuring rates per model
interface ModelRatesConfigProps {
  models: string;
  modelConfigs: Record<string, IModelConfig> | undefined;
  onChange: (configs: Record<string, IModelConfig>) => void;
  // Hides pricing in space-level settings (billing doesn't apply to BYOK there);
  // token caps stay visible everywhere.
  hideModelRates?: boolean;
}

const getGatewayReferenceModel = (
  model: string,
  gatewayModels: IGatewayModelAPI[]
): IGatewayModelAPI | undefined => {
  const normalizedModel = model.toLowerCase();
  const direct = gatewayModels.find((item) => item.id.toLowerCase() === normalizedModel);
  if (direct) return direct;

  return gatewayModels.find((item) => {
    const id = item.id.toLowerCase();
    return id.endsWith(`/${normalizedModel}`) || normalizedModel.endsWith(`/${id}`);
  });
};

const getPricingSummary = (pricing: IModelPricing | undefined): string => {
  if (!pricing) return '-';
  if (pricing.input || pricing.output) {
    return `${formatUsdPriceShort(pricing.input)} / ${formatUsdPriceShort(pricing.output)}`;
  }
  if (pricing.image) return `$${pricing.image}`;
  if (pricing.webSearch) return `$${pricing.webSearch}/1K`;
  return '-';
};

const inferGatewayRatio = (
  currentPricing: IModelPricing | undefined,
  referencePricing: IModelPricing | undefined
): number | undefined => {
  const fields: (keyof Pick<
    IModelPricing,
    'input' | 'output' | 'inputCacheRead' | 'inputCacheWrite' | 'reasoning' | 'image' | 'webSearch'
  >)[] = [
    'input',
    'output',
    'inputCacheRead',
    'inputCacheWrite',
    'reasoning',
    'image',
    'webSearch',
  ];

  for (const field of fields) {
    const current = currentPricing?.[field];
    const reference = referencePricing?.[field];
    if (!current || !reference) continue;
    const currentValue = parseFloat(current);
    const referenceValue = parseFloat(reference);
    if (Number.isNaN(currentValue) || Number.isNaN(referenceValue) || referenceValue === 0) {
      continue;
    }
    return currentValue / referenceValue;
  }
};

const formatGatewayRatio = (ratio: number | undefined): string => {
  if (ratio === undefined || Number.isNaN(ratio)) return '';
  if (ratio === 0) return '0';
  if (ratio < 0.0001) return ratio.toPrecision(3);
  if (ratio < 1) return ratio.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return ratio.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
};

// Ratios must be positive — 0 would zero out pricing and make the model unbillable.
const parseGatewayRatio = (value: string): number | undefined => {
  const ratio = parseFloat(value);
  if (Number.isNaN(ratio) || ratio <= 0) return undefined;
  return ratio;
};

const getLLMProviderDefaultValues = (
  value: LLMProvider | undefined,
  isAutoProviderName: boolean
): LLMProvider => {
  if (value) {
    return { ...value, displayName: value.displayName || value.name };
  }

  return {
    name: isAutoProviderName ? generateByokProviderName() : 'teable',
    displayName: '',
    type: LLMProviderType.OPENAI,
    apiKey: '',
    baseUrl: '',
    models: '',
    modelConfigs: {},
  };
};

function ModelListEditor({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const { t } = useTranslation();
  const [customInput, setCustomInput] = useState('');
  // '@' is reserved for model keys.
  const hasReservedAt = customInput.includes('@');
  const models = useMemo(
    () =>
      value
        .split(',')
        .map((m) => m.trim())
        .filter(Boolean),
    [value]
  );

  const commit = (next: string[]) => {
    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const raw of next) {
      const name = raw.trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        deduped.push(name);
      }
    }
    onChange(deduped.join(','));
  };

  const addCustom = () => {
    const name = customInput.trim();
    if (!name || name.includes('@')) return;
    commit([...models, name]);
    setCustomInput('');
  };

  return (
    <div className="space-y-2">
      {models.length > 0 && (
        <div className="grid gap-2 rounded-md border bg-muted/20 p-2 sm:grid-cols-2">
          {models.map((model) => (
            <div
              key={model}
              className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-1.5 text-sm"
            >
              <span className="truncate">{model}</span>
              <button
                type="button"
                aria-label={`remove ${model}`}
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => commit(models.filter((m) => m !== model))}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {t('admin.setting.ai.modelsSelectedCount', { count: models.length })}
        </span>
        {models.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto py-0.5 text-destructive hover:text-destructive"
            onClick={() => onChange('')}
          >
            {t('admin.setting.ai.clearAllModels')}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={customInput}
          autoComplete="off"
          placeholder={placeholder || t('admin.setting.ai.customModelPlaceholder')}
          onChange={(e) => setCustomInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustom();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          onClick={addCustom}
          disabled={!customInput.trim() || hasReservedAt}
        >
          {t('admin.setting.ai.addModelFill')}
        </Button>
      </div>
      {hasReservedAt && (
        <p className="text-xs text-amber-600">{t('admin.setting.ai.modelIdReservedAt')}</p>
      )}
    </div>
  );
}

const ModelRatesConfig = ({
  models,
  modelConfigs = {},
  onChange,
  hideModelRates,
}: ModelRatesConfigProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [editingModel, setEditingModel] = useState<string | null>(null);

  const modelList = useMemo(() => {
    return models
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
  }, [models]);

  const {
    models: gatewayModels,
    isFetching: isLoadingPricing,
    errorMessage: pricingError,
    refetch: fetchGatewayPricing,
  } = useGatewayModelsQuery();

  // Effective reference: the admin-picked gateway model wins; fall back to auto-match.
  const resolveReferenceModel = useCallback(
    (model: string): IGatewayModelAPI | undefined => {
      const explicit = modelConfigs[model]?.referenceModel;
      const explicitMatch = explicit
        ? gatewayModels.find((item) => item.id === explicit)
        : undefined;
      return explicitMatch ?? getGatewayReferenceModel(model, gatewayModels);
    },
    [modelConfigs, gatewayModels]
  );

  // Materialize reference pricing (×1) plus caps/tags into models that have none, so
  // custom model names stay billable without the admin opening each per-model editor
  // and the backend model-caps resolution (which only reads modelConfigs[model]) sees
  // the same caps the editor displays. The reference match itself stays dynamic. This
  // also runs in space-level settings (hideModelRates): the stored pricing is inert
  // for BYOK.
  useEffect(() => {
    if (gatewayModels.length === 0) return;
    const filled: Record<string, IModelConfig> = {};
    for (const model of modelList) {
      const config = modelConfigs[model];
      if (config?.pricing) continue;
      const reference = resolveReferenceModel(model);
      if (!reference?.pricing) continue;
      const pricing = scalePricing(reference.pricing, 1);
      if (!pricing) continue;
      filled[model] = {
        ...config,
        pricing,
        contextWindow: config?.contextWindow ?? reference.contextWindow,
        maxTokens: config?.maxTokens ?? reference.maxTokens,
        tags: config?.tags ?? reference.tags,
      };
    }
    if (Object.keys(filled).length > 0) {
      onChange({ ...modelConfigs, ...filled });
    }
  }, [gatewayModels, modelList, modelConfigs, resolveReferenceModel, onChange]);

  // Auto-expand when a model shows up that neither auto-matches a gateway reference
  // nor has a saved config, so the admin is guided to configure it instead of
  // discovering blank pricing/caps later. Each model is evaluated once (tracked in a
  // ref) so a manual collapse isn't fought on re-renders; only runs once the gateway
  // list is loaded — before that (or on community edition) every model looks unmatched.
  const evaluatedModelsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (gatewayModels.length === 0) return;
    const newModels = modelList.filter((model) => !evaluatedModelsRef.current.has(model));
    newModels.forEach((model) => evaluatedModelsRef.current.add(model));
    const needsSetup = (model: string) => {
      const config = modelConfigs[model];
      const configured =
        config?.pricing || config?.contextWindow != null || config?.maxTokens != null;
      return !configured && !resolveReferenceModel(model);
    };
    if (newModels.some(needsSetup)) setExpanded(true);
  }, [gatewayModels, modelList, modelConfigs, resolveReferenceModel]);

  if (modelList.length === 0) return null;

  const gridColsClass = hideModelRates
    ? 'grid-cols-[minmax(120px,1fr),90px,90px,32px]'
    : 'grid-cols-[minmax(120px,1fr),190px,56px,90px,90px,32px]';

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        {expanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
        {t('admin.setting.ai.modelSettings')} ({modelList.length})
      </button>

      {expanded && (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          {!hideModelRates ? (
            <div className="rounded bg-blue-50 p-2 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-200">
              <div className="font-medium">{t('admin.setting.ai.rateExplanationTitle')}</div>
              <div className="mt-1 space-y-0.5 text-[11px] opacity-90">
                <div>• {t('admin.setting.ai.rateExplanationFormula')}</div>
                <div>• {t('admin.setting.ai.rateExplanationExample')}</div>
                <div>• {t('admin.setting.ai.rateExplanationManual')}</div>
                <div>• {t('admin.setting.ai.rateExplanationCaps')}</div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('admin.setting.ai.rateExplanationCaps')}
            </p>
          )}

          {!hideModelRates && pricingError && (
            <div className="text-xs text-destructive">
              {t('admin.setting.ai.fetchPricingError')}: {pricingError}
            </div>
          )}

          <div className="overflow-x-auto">
            <div className={cn('space-y-2', !hideModelRates && 'min-w-[620px]')}>
              <div
                className={cn(
                  'grid gap-2 text-xs font-medium text-muted-foreground',
                  gridColsClass
                )}
              >
                <div>{t('admin.setting.ai.model')}</div>
                {!hideModelRates && (
                  <>
                    <div title={t('admin.setting.ai.generatedPricingTip')}>
                      {t('admin.setting.ai.generatedPricing')}
                    </div>
                    <div title={t('admin.setting.ai.relativeRatioTip')}>
                      {t('admin.setting.ai.relativeRatio')}
                    </div>
                  </>
                )}
                <div title={t('admin.setting.ai.contextWindowCapTip')}>
                  {t('admin.setting.ai.contextWindowCap')}
                </div>
                <div title={t('admin.setting.ai.maxOutputTokensCapTip')}>
                  {t('admin.setting.ai.maxOutputTokensCap')}
                </div>
                <div />
              </div>
              {modelList.map((model) => {
                const config = modelConfigs[model] || {};
                const currentPricing = config.pricing;
                const multiplier = formatMultiplier(calculateMultiplier(currentPricing));
                return (
                  <div key={model} className={cn('grid items-center gap-2', gridColsClass)}>
                    <div className="truncate text-sm" title={model}>
                      {model}
                    </div>
                    {!hideModelRates && (
                      <>
                        <div
                          className="truncate text-xs tabular-nums text-muted-foreground"
                          title={getPricingSummary(currentPricing)}
                        >
                          {getPricingSummary(currentPricing)}
                        </div>
                        <div className="text-xs font-medium tabular-nums">{multiplier ?? '-'}</div>
                      </>
                    )}
                    <div className="truncate text-xs tabular-nums text-muted-foreground">
                      {config.contextWindow ?? '-'}
                    </div>
                    <div className="truncate text-xs tabular-nums text-muted-foreground">
                      {config.maxTokens ?? '-'}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="size-7 p-0"
                      aria-label={t('actions.edit')}
                      onClick={() => setEditingModel(model)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>

          {!hideModelRates && (
            <p className="text-xs text-muted-foreground">
              {t('admin.setting.ai.ratesDescription')}
            </p>
          )}
        </div>
      )}

      {/* Per-model editor: reference model, derived pricing, and token caps live together.
          Keyed and mounted per open so draft input state can't leak between models. */}
      {editingModel && (
        <ModelEditorDialog
          key={editingModel}
          model={editingModel}
          config={modelConfigs[editingModel] || {}}
          referenceModel={resolveReferenceModel(editingModel)}
          gatewayModels={gatewayModels}
          isLoadingModels={isLoadingPricing}
          modelsError={pricingError}
          onRetry={() => fetchGatewayPricing()}
          hideModelRates={hideModelRates}
          onConfigChange={(config) => onChange({ ...modelConfigs, [editingModel]: config })}
          onClose={() => setEditingModel(null)}
        />
      )}
    </div>
  );
};

interface IModelEditorDialogProps {
  model: string;
  config: IModelConfig;
  /** Effective reference resolved by the parent (explicit pick or auto-match). */
  referenceModel: IGatewayModelAPI | undefined;
  gatewayModels: IGatewayModelAPI[];
  isLoadingModels: boolean;
  modelsError: string | null;
  onRetry: () => void;
  hideModelRates?: boolean;
  onConfigChange: (config: IModelConfig) => void;
  onClose: () => void;
}

const ModelEditorDialog = ({
  model,
  config,
  referenceModel,
  gatewayModels,
  isLoadingModels,
  modelsError,
  onRetry,
  hideModelRates,
  onConfigChange,
  onClose,
}: IModelEditorDialogProps) => {
  const { t } = useTranslation();
  const [referencePickerOpen, setReferencePickerOpen] = useState(false);
  const [referenceSearchQuery, setReferenceSearchQuery] = useState('');
  // Draft input strings; null falls back to the persisted config value.
  const [ratioInput, setRatioInput] = useState<string | null>(null);
  const [capsInput, setCapsInput] = useState<{ contextWindow?: string; maxTokens?: string }>({});

  const filteredReferenceModels = useMemo(() => {
    const query = referenceSearchQuery.trim().toLowerCase();
    if (!query) return gatewayModels.slice(0, 50);
    return gatewayModels
      .filter(
        (item) => item.id.toLowerCase().includes(query) || item.name?.toLowerCase().includes(query)
      )
      .slice(0, 50);
  }, [gatewayModels, referenceSearchQuery]);

  const referencePricing = referenceModel?.pricing;
  const currentPricing = config.pricing;
  const referenceMultiplier = formatMultiplier(calculateMultiplier(referencePricing));
  const ratioValue =
    ratioInput ?? formatGatewayRatio(inferGatewayRatio(currentPricing, referencePricing));

  const applyPricingRatio = (value: string) => {
    setRatioInput(value);
    if (!referencePricing) return;
    const ratio = parseGatewayRatio(value);
    if (ratio === undefined) return;
    onConfigChange({ ...config, pricing: scalePricing(referencePricing, ratio) });
  };

  const applyReferenceModel = (reference: IGatewayModelAPI, ratio: number) => {
    onConfigChange({
      ...config,
      referenceModel: reference.id,
      pricing: reference.pricing ? scalePricing(reference.pricing, ratio) : config.pricing,
      contextWindow: reference.contextWindow ?? config.contextWindow,
      maxTokens: reference.maxTokens ?? config.maxTokens,
      tags: reference.tags ?? config.tags,
    });
    // Drop the string drafts so the copied reference caps become visible.
    setCapsInput({});
  };

  const applyCap = (field: 'contextWindow' | 'maxTokens', value: string) => {
    setCapsInput((prev) => ({ ...prev, [field]: value }));
    const trimmed = value.trim();
    if (!trimmed) {
      onConfigChange({ ...config, [field]: undefined });
      return;
    }
    const num = parseInt(trimmed, 10);
    if (Number.isNaN(num) || num <= 0) return;
    onConfigChange({ ...config, [field]: num });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="break-all text-base">{model}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <div
              className="text-xs font-medium text-muted-foreground"
              title={t('admin.setting.ai.referencePricingTip')}
            >
              {t('admin.setting.ai.referenceModelLabel')}
            </div>
            <ModelSearchPopover
              open={referencePickerOpen}
              onOpenChange={setReferencePickerOpen}
              selectedModelId={referenceModel?.id ?? ''}
              isLoadingModels={isLoadingModels}
              modelsLoadError={modelsError}
              filteredModels={filteredReferenceModels}
              searchQuery={referenceSearchQuery}
              onSearchQueryChange={setReferenceSearchQuery}
              onSelectModel={(modelId) => {
                const reference = gatewayModels.find((item) => item.id === modelId);
                if (reference) {
                  // Empty/invalid ratio defaults to ×1 so picking a reference
                  // always copies its pricing (an unbillable model 403s later).
                  applyReferenceModel(reference, parseGatewayRatio(ratioValue) ?? 1);
                }
                setReferencePickerOpen(false);
              }}
              onRetry={onRetry}
              t={t}
            />
            {!hideModelRates && (
              <div className="text-xs tabular-nums text-muted-foreground">
                {referencePricing
                  ? `${getPricingSummary(referencePricing)}${referenceMultiplier ? ` · ${referenceMultiplier}` : ''}`
                  : t('admin.setting.ai.notFound')}
              </div>
            )}
          </div>
          {!hideModelRates && (
            <>
              {referencePricing && (
                <div className="space-y-1">
                  <div
                    className="text-xs font-medium text-muted-foreground"
                    title={t('admin.setting.ai.gatewayRatioTip')}
                  >
                    {t('admin.setting.ai.gatewayRatio')}
                  </div>
                  <Input
                    type="text"
                    value={ratioValue}
                    onChange={(e) => applyPricingRatio(e.target.value)}
                    placeholder="1"
                    size="sm"
                  />
                </div>
              )}
              <div className="space-y-1">
                {/* Pricing is always derived from reference × ratio; shown read-only. */}
                <div
                  className="text-xs font-medium text-muted-foreground"
                  title={t('admin.setting.ai.generatedPricingTip')}
                >
                  {t('admin.setting.ai.generatedPricing')}
                </div>
                <div className="text-sm tabular-nums">{getPricingSummary(currentPricing)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs font-medium text-muted-foreground">
                  {t('admin.setting.ai.advancedRates')}
                </div>
                <div className="grid grid-cols-5 gap-2">
                  <div>
                    <div
                      className="text-[10px] text-muted-foreground"
                      title={t('admin.setting.ai.cacheReadRateTip')}
                    >
                      {t('admin.setting.ai.cacheRead')}
                    </div>
                    <div className="truncate text-xs tabular-nums">
                      {currentPricing?.inputCacheRead ?? '-'}
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-[10px] text-muted-foreground"
                      title={t('admin.setting.ai.cacheWriteRateTip')}
                    >
                      {t('admin.setting.ai.cacheWrite')}
                    </div>
                    <div className="truncate text-xs tabular-nums">
                      {currentPricing?.inputCacheWrite ?? '-'}
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-[10px] text-muted-foreground"
                      title={t('admin.setting.ai.reasoningRateTip')}
                    >
                      {t('admin.setting.ai.reasoning')}
                    </div>
                    <div className="truncate text-xs tabular-nums">
                      {currentPricing?.reasoning ?? '-'}
                    </div>
                  </div>
                  <div>
                    <div
                      className="text-[10px] text-muted-foreground"
                      title={t('admin.setting.ai.imageRateTip')}
                    >
                      {t('admin.setting.ai.perImage')}
                    </div>
                    <div className="truncate text-xs tabular-nums">
                      {currentPricing?.image ?? '-'}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-muted-foreground">
                      {t('admin.setting.ai.webSearch')}
                    </div>
                    <div className="truncate text-xs tabular-nums">
                      {currentPricing?.webSearch ?? '-'}
                    </div>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {t('admin.setting.ai.advancedRatesDescription')}
                </p>
              </div>
            </>
          )}
          <div className="space-y-3">
            <div className="space-y-1">
              <div
                className="text-xs font-medium text-muted-foreground"
                title={t('admin.setting.ai.contextWindowCapTip')}
              >
                {t('admin.setting.ai.contextWindowCap')}
              </div>
              <Input
                type="text"
                inputMode="numeric"
                value={
                  capsInput.contextWindow ??
                  (config.contextWindow != null ? String(config.contextWindow) : '')
                }
                onChange={(e) => applyCap('contextWindow', e.target.value)}
                placeholder={
                  referenceModel?.contextWindow ? String(referenceModel.contextWindow) : '128000'
                }
                size="sm"
              />
            </div>
            <div className="space-y-1">
              <div
                className="text-xs font-medium text-muted-foreground"
                title={t('admin.setting.ai.maxOutputTokensCapTip')}
              >
                {t('admin.setting.ai.maxOutputTokensCap')}
              </div>
              <Input
                type="text"
                inputMode="numeric"
                value={
                  capsInput.maxTokens ?? (config.maxTokens != null ? String(config.maxTokens) : '')
                }
                onChange={(e) => applyCap('maxTokens', e.target.value)}
                placeholder={referenceModel?.maxTokens ? String(referenceModel.maxTokens) : '8192'}
                size="sm"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const LLMProviderForm = ({
  value,
  onAdd,
  onChange,
  onTest,
  hideModelRates,
  onSaveTestResult,
  providerNameMode = 'manual',
}: LLMProviderFormProps) => {
  const { t } = useTranslation();
  const [isTestLoading, setIsTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  // Progress and pass/fail are derived from modelTestStatuses at render, so
  // they can never drift out of sync with the per-model pills.
  const [modelTestStatuses, setModelTestStatuses] = useState<IModelTestStatus[]>([]);
  const abortRef = useRef(false);
  const isAutoProviderName = providerNameMode === 'auto';

  const form = useForm<LLMProvider>({
    resolver: zodResolver(llmProviderSchema),
    defaultValues: getLLMProviderDefaultValues(value, isAutoProviderName),
  });

  // Clear test result when form values change
  const baseUrl = form.watch('baseUrl');
  const apiKey = form.watch('apiKey');
  const models = form.watch('models');
  const formType = form.watch('type');
  useEffect(() => {
    setTestResult(null);
    setModelTestStatuses([]);
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
      return testImageModelCapability({
        modelKey: `${provider.type}@${model}@${provider.name}`,
        provider,
        onTest,
      });
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

    // Initialize all models as pending
    const initialStatuses: IModelTestStatus[] = modelList.map((model) => ({
      model,
      status: 'pending',
      isImageModel: formData.modelConfigs?.[model]?.isImageModel,
    }));
    setModelTestStatuses(initialStatuses);

    const provider = formData as Required<LLMProvider>;
    let successCount = 0;
    let nextIndex = 0;
    const errors: string[] = [];

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
      if (result.status === 'failed' && result.error) {
        errors.push(result.error);
      }
      if (result.status === 'success') {
        successCount++;
        // Save test result to form's modelConfigs so it persists on submit
        const currentConfigs = form.getValues('modelConfigs') ?? {};
        const tags = getImageModelTagsFromAbility(result.imageAbility, currentConfigs[model]?.tags);
        form.setValue('modelConfigs', {
          ...currentConfigs,
          [model]: {
            ...currentConfigs[model],
            ability: result.ability,
            imageAbility: result.imageAbility,
            ...(result.imageAbility ? { tags } : {}),
            testedAt: Date.now(),
          },
        });
        // Save test result to parent provider config (for already-added providers)
        const modelKey = `${provider.type}@${model}@${provider.name}`;
        onSaveTestResult?.(modelKey, result.ability, result.imageAbility);
      }

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
      toast.success(
        t('admin.setting.ai.testCompleteWithCount', {
          success: successCount,
          total: modelList.length,
        })
      );
    }

    // Show error details whenever any model fails
    if (errors.length > 0) {
      const firstError = errors[0];
      const analysis = analyzeError(firstError, provider.baseUrl, provider.type);
      setTestResult({
        success: false,
        message:
          successCount === 0
            ? `${t('admin.setting.ai.allTestsFailed')}: ${analysis.message}`
            : analysis.message,
        suggestions: analysis.suggestions,
      });
    }
  }, [form, t, testTextModel, testImageModel, onSaveTestResult]);

  const handleStopTest = useCallback(() => {
    abortRef.current = true;
    setIsTestLoading(false);
  }, []);

  // Stable reference: this is a dependency of ModelRatesConfig's pricing
  // materialization effect, which would otherwise re-run on every keystroke.
  const handleModelConfigsChange = useCallback(
    (configs: Record<string, IModelConfig>) =>
      form.setValue('modelConfigs', configs, { shouldDirty: true }),
    [form]
  );

  const mode = onChange ? t('actions.update') : t('actions.add');
  // The display name and the pricing of existing models don't affect whether a model works, so
  // they can be saved without a test. Anything that changes how/which models are called — base
  // URL, API key, provider type, or the model list — must pass a test first. (Reading these
  // formState fields during render subscribes the component to them.)
  const { isDirty, dirtyFields } = form.formState;
  const connectivityDirty = Boolean(
    dirtyFields.baseUrl || dirtyFields.apiKey || dirtyFields.type || dirtyFields.models
  );
  const canSaveWithoutTest = Boolean(value) && isDirty && !connectivityDirty;
  const type = form.watch('type');
  const currentProvider = LLM_PROVIDERS.find((provider) => provider.value === type);
  const providerOptions = LLM_PROVIDERS.filter(
    (provider) => !provider.hideInProviderSelect || provider.value === type
  );

  // Calculate test statistics (all derived from the per-model statuses)
  const successCount = modelTestStatuses.filter((s) => s.status === 'success').length;
  const failedCount = modelTestStatuses.filter((s) => s.status === 'failed').length;
  const totalCount = modelTestStatuses.length;
  const progressPercent =
    totalCount > 0 ? Math.round(((successCount + failedCount) / totalCount) * 100) : 0;
  const testPassed = !isTestLoading && successCount > 0;

  return (
    <Form {...form}>
      <FormField
        name="name"
        render={({ field }) => (
          // Internal identifier (normalized to 'teable' server-side). Kept registered so its
          // value stays in form state for in-session modelKeys, but hidden from the UI.
          <FormItem className="hidden">
            <FormControl>
              <Input {...field} readOnly autoComplete="off" />
            </FormControl>
          </FormItem>
        )}
      />
      <FormField
        name="displayName"
        render={({ field }) => (
          <FormItem className={isAutoProviderName ? 'hidden' : undefined}>
            <div>
              <FormLabel>{t('admin.setting.ai.name')}</FormLabel>
              <FormDescription>{t('admin.setting.ai.nameDescription')}</FormDescription>
            </div>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                autoComplete="off"
                placeholder="OpenAI / Company Gateway ..."
              />
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
                  {providerOptions.map(({ value, label, Icon, hideInProviderSelect }) => (
                    <SelectItem key={value} value={value} disabled={hideInProviderSelect}>
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
                  <ModelListEditor
                    value={field.value ?? ''}
                    onChange={field.onChange}
                    placeholder={currentProvider.modelsPlaceholder}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          {/* Pricing shows on every edition; space-level settings (hideModelRates) only
              expose the per-model token caps since billing doesn't apply to BYOK. */}
          <ModelRatesConfig
            models={form.watch('models') || ''}
            modelConfigs={form.watch('modelConfigs')}
            onChange={handleModelConfigsChange}
            hideModelRates={hideModelRates}
          />

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
              <div className="flex items-center gap-3">
                <Progress value={progressPercent} className="h-1.5 flex-1" />
                <div className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
                  {isTestLoading && <Loader2 className="size-3 animate-spin" />}
                  <span>{progressPercent}%</span>
                  <span className="text-green-600 dark:text-green-400">{successCount} ✓</span>
                  <span className="text-red-600 dark:text-red-400">{failedCount} ✗</span>
                </div>
              </div>
              {/* Model test results */}
              <div className="flex flex-wrap gap-2">
                {modelTestStatuses.map((status) => (
                  <ModelTestPill key={status.model} status={status} />
                ))}
              </div>
              {/* Per-model error messages */}
              {modelTestStatuses.some((s) => s.status === 'failed' && s.error) && (
                <div className="space-y-1">
                  {modelTestStatuses
                    .filter((s) => s.status === 'failed' && s.error)
                    .map((s) => (
                      <div
                        key={s.model}
                        className="flex items-start gap-1.5 text-xs text-destructive"
                      >
                        <X className="mt-0.5 size-3 shrink-0" />
                        <span>
                          <span className="font-medium">{s.model}</span>: {s.error}
                        </span>
                      </div>
                    ))}
                </div>
              )}
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
                    // Outline when the Update button is also shown, so Test (secondary) and
                    // Update (filled primary) are easy to tell apart; filled only when Test is
                    // the sole required action.
                    variant={testPassed || canSaveWithoutTest ? 'outline' : 'default'}
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
            {(testPassed || canSaveWithoutTest) && (
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
