import { Loader2, Play, Square } from '@teable/icons';
import { chatModelAbilityType } from '@teable/openapi';
import type {
  IChatModelAbility,
  IImageModelAbility,
  ITestLLMRo,
  ITestLLMVo,
  LLMProvider,
} from '@teable/openapi';
import { Button, Progress } from '@teable/ui-lib/shadcn';
import { useTranslation } from 'next-i18next';
import { useState, useCallback, useRef, useEffect } from 'react';
import type { IModelTestResult } from './LlmproviderManage';
import { generateModelKeyList, parseModelKey } from './utils';

interface IBatchTestModelsProps {
  providers: LLMProvider[];
  disabled?: boolean;
  /** Test function - accepts full ITestLLMRo for capability testing */
  onTest: (data: ITestLLMRo) => Promise<ITestLLMVo>;
  onResultsChange?: (results: Map<string, IModelTestResult>) => void;
  onSaveResult?: (
    modelKey: string,
    ability: IChatModelAbility | undefined,
    imageAbility: IImageModelAbility | undefined
  ) => void;
  onTestingProvidersChange?: (testingProviders: Set<string>) => void;
  onTestingModelsChange?: (testingModels: Set<string>) => void;
  onTestProvider?: (callback: (provider: LLMProvider) => void) => void;
  onTestModel?: (
    callback: (provider: LLMProvider, model: string, modelKey: string) => Promise<void>
  ) => void;
}

const CONCURRENCY = 5;
const TEXT_MODEL_TIMEOUT_MS = 30000; // 30 seconds timeout for text models
const IMAGE_MODEL_TIMEOUT_MS = 120000; // 2 minutes timeout for image models

// Helper to wrap promise with timeout
const withTimeout = <T,>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), ms)),
  ]);
};

export const BatchTestModels = ({
  providers,
  disabled,
  onTest,
  onResultsChange,
  onSaveResult,
  onTestingProvidersChange,
  onTestingModelsChange,
  onTestProvider,
  onTestModel,
}: IBatchTestModelsProps) => {
  const { t } = useTranslation('common');
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const abortRef = useRef(false);
  const resultsRef = useRef<Map<string, IModelTestResult>>(new Map());
  const isRunningRef = useRef(false);
  const initializedRef = useRef(false);
  const testingProvidersRef = useRef<Set<string>>(new Set());
  const testingModelsRef = useRef<Set<string>>(new Set());

  // Build model list from providers
  const modelList = generateModelKeyList(providers);

  // Load persisted results only on initial mount
  useEffect(() => {
    // Skip if test is running or already initialized
    if (isRunningRef.current || initializedRef.current) return;

    initializedRef.current = true;
    const initialResults = new Map<string, IModelTestResult>();
    providers.forEach((provider) => {
      const models =
        provider.models
          ?.split(',')
          .map((m) => m.trim())
          .filter(Boolean) || [];
      models.forEach((model) => {
        const modelKey = `${provider.type}@${model}@${provider.name}`;
        const config = provider.modelConfigs?.[model];
        // Load text model results
        if (config?.ability) {
          initialResults.set(modelKey, {
            modelKey,
            status: 'success',
            ability: config.ability,
            isImageModel: false,
          });
        }
        // Load image model results
        if (config?.imageAbility) {
          initialResults.set(modelKey, {
            modelKey,
            status: 'success',
            imageAbility: config.imageAbility,
            isImageModel: true,
          });
        }
      });
    });
    resultsRef.current = initialResults;
    onResultsChange?.(new Map(initialResults));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateResult = useCallback(
    (modelKey: string, update: Partial<IModelTestResult>) => {
      const existing = resultsRef.current.get(modelKey) || {
        modelKey,
        status: 'idle' as const,
      };
      resultsRef.current.set(modelKey, { ...existing, ...update });
      onResultsChange?.(new Map(resultsRef.current));
    },
    [onResultsChange]
  );

  const testTextModel = useCallback(
    async (
      modelKey: string,
      provider: Required<LLMProvider>
    ): Promise<Partial<IModelTestResult>> => {
      try {
        const { type, name, apiKey, baseUrl, models } = provider;

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

  const testImageModel = useCallback(
    async (
      modelKey: string,
      provider: Required<LLMProvider>
    ): Promise<Partial<IModelTestResult>> => {
      try {
        const { type, name, apiKey, baseUrl, models } = provider;

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

  const handleBatchTest = useCallback(async () => {
    if (modelList.length === 0) {
      return;
    }

    abortRef.current = false;
    isRunningRef.current = true;
    setIsRunning(true);

    // Initialize all as pending
    modelList.forEach(({ modelKey }) => {
      updateResult(modelKey, { status: 'pending' });
    });
    setProgress({ current: 0, total: modelList.length });

    // Sliding window concurrent execution
    let completedCount = 0;
    let nextIndex = 0;
    // eslint-disable-next-line sonarjs/no-unused-collection
    const inProgress = new Set<string>();

    const startNextTest = async () => {
      if (abortRef.current || nextIndex >= modelList.length) return;

      const currentIndex = nextIndex++;
      const { modelKey } = modelList[currentIndex];
      const { type, name } = parseModelKey(modelKey);
      const provider = providers.find(
        (p) => p.type === type && p.name === name
      ) as Required<LLMProvider>;

      inProgress.add(modelKey);
      updateResult(modelKey, { status: 'testing' });

      let result: Partial<IModelTestResult>;
      if (!provider) {
        result = { status: 'failed', error: 'Provider not found' };
      } else {
        // Check if this is an image model
        const modelInfo = modelList.find((m) => m.modelKey === modelKey);
        const isImageModel = modelInfo?.isImageModel;
        result = isImageModel
          ? await testImageModel(modelKey, provider)
          : await testTextModel(modelKey, provider);
      }

      // Update result and progress
      updateResult(modelKey, result);
      inProgress.delete(modelKey);
      completedCount++;
      setProgress({ current: completedCount, total: modelList.length });

      // Persist successful test results
      if (result.status === 'success') {
        onSaveResult?.(modelKey, result.ability, result.imageAbility);
      }

      // Start next test if there are more
      if (!abortRef.current && nextIndex < modelList.length) {
        await startNextTest();
      }
    };

    // Start initial concurrent tests
    const initialPromises: Promise<void>[] = [];
    for (let i = 0; i < Math.min(CONCURRENCY, modelList.length); i++) {
      initialPromises.push(startNextTest());
    }

    await Promise.all(initialPromises);
    isRunningRef.current = false;
    setIsRunning(false);
  }, [modelList, providers, updateResult, onSaveResult, testTextModel, testImageModel]);

  const handleStop = useCallback(() => {
    abortRef.current = true;
    isRunningRef.current = false;
    setIsRunning(false);
  }, []);

  // Test a single provider's models
  const testSingleProvider = useCallback(
    async (provider: LLMProvider) => {
      const providerKey = `${provider.type}@${provider.name}`;
      const providerModels =
        provider.models
          ?.split(',')
          .map((m) => m.trim())
          .filter(Boolean) || [];

      if (providerModels.length === 0) return;

      // Mark provider as testing
      testingProvidersRef.current.add(providerKey);
      onTestingProvidersChange?.(new Set(testingProvidersRef.current));

      // Initialize models as pending
      providerModels.forEach((model) => {
        const modelKey = `${provider.type}@${model}@${provider.name}`;
        updateResult(modelKey, { status: 'pending' });
      });

      // Test each model with sliding window
      let nextIndex = 0;

      const startNextTest = async () => {
        if (nextIndex >= providerModels.length) return;

        const currentIndex = nextIndex++;
        const model = providerModels[currentIndex];
        const modelKey = `${provider.type}@${model}@${provider.name}`;

        updateResult(modelKey, { status: 'testing' });

        // Check if this is an image model
        const isImageModel = provider.modelConfigs?.[model]?.isImageModel;
        const result = isImageModel
          ? await testImageModel(modelKey, provider as Required<LLMProvider>)
          : await testTextModel(modelKey, provider as Required<LLMProvider>);

        updateResult(modelKey, result);

        // Persist successful test results
        if (result.status === 'success') {
          onSaveResult?.(modelKey, result.ability, result.imageAbility);
        }

        // Start next test if there are more
        if (nextIndex < providerModels.length) {
          await startNextTest();
        }
      };

      // Start concurrent tests
      const initialPromises: Promise<void>[] = [];
      for (let i = 0; i < Math.min(CONCURRENCY, providerModels.length); i++) {
        initialPromises.push(startNextTest());
      }

      await Promise.all(initialPromises);

      // Mark provider as done
      testingProvidersRef.current.delete(providerKey);
      onTestingProvidersChange?.(new Set(testingProvidersRef.current));
    },
    [updateResult, onSaveResult, onTestingProvidersChange, testTextModel, testImageModel]
  );

  // Test a single model
  const testSingleModel = useCallback(
    async (provider: LLMProvider, model: string, modelKey: string) => {
      // Mark model as testing
      testingModelsRef.current.add(modelKey);
      onTestingModelsChange?.(new Set(testingModelsRef.current));

      updateResult(modelKey, { status: 'testing' });

      // Check if this is an image model
      const isImageModel = provider.modelConfigs?.[model]?.isImageModel;
      const result = isImageModel
        ? await testImageModel(modelKey, provider as Required<LLMProvider>)
        : await testTextModel(modelKey, provider as Required<LLMProvider>);

      updateResult(modelKey, result);

      // Persist successful test results
      if (result.status === 'success') {
        onSaveResult?.(modelKey, result.ability, result.imageAbility);
      }

      // Mark model as done
      testingModelsRef.current.delete(modelKey);
      onTestingModelsChange?.(new Set(testingModelsRef.current));
    },
    [updateResult, onSaveResult, onTestingModelsChange, testTextModel, testImageModel]
  );

  // Expose the testSingleProvider function to parent via callback
  useEffect(() => {
    onTestProvider?.((provider: LLMProvider) => {
      testSingleProvider(provider);
    });
  }, [onTestProvider, testSingleProvider]);

  // Expose the testSingleModel function to parent via callback
  useEffect(() => {
    onTestModel?.((provider: LLMProvider, model: string, modelKey: string) =>
      testSingleModel(provider, model, modelKey)
    );
  }, [onTestModel, testSingleModel]);

  const successCount = Array.from(resultsRef.current.values()).filter(
    (r) => r.status === 'success'
  ).length;
  const failedCount = Array.from(resultsRef.current.values()).filter(
    (r) => r.status === 'failed'
  ).length;
  const progressPercent =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const hasResults =
    resultsRef.current.size > 0 &&
    Array.from(resultsRef.current.values()).some((r) => r.status !== 'idle');

  if (modelList.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      {/* Header with test button and progress */}
      <div className="flex items-center gap-4">
        {isRunning ? (
          <Button variant="destructive" size="xs" onClick={handleStop} className="gap-2">
            <Square className="size-3" />
            {t('admin.setting.ai.stopTest')}
          </Button>
        ) : (
          <Button
            variant="outline"
            size="xs"
            onClick={handleBatchTest}
            disabled={disabled}
            className="gap-2"
          >
            <Play className="size-4" />
            {t('admin.setting.ai.batchTest')}
          </Button>
        )}

        {/* Progress inline */}
        {(isRunning || hasResults) && progress.total > 0 && (
          <div className="flex flex-1 items-center gap-3">
            <Progress value={progressPercent} className="h-1.5 flex-1" />
            <div className="flex items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">
              {isRunning && <Loader2 className="size-4 animate-spin" />}
              <span>{progressPercent}%</span>
              <span className="text-green-600 dark:text-green-400">{successCount} ✓</span>
              <span className="text-red-600 dark:text-red-400">{failedCount} ✗</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
