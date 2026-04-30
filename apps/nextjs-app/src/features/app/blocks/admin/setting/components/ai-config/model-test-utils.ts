import type { IImageModelAbility, ITestLLMRo, ITestLLMVo, LLMProvider } from '@teable/openapi';
import { supportsKnownImageInputForImageModel } from '@teable/openapi';
import { parseModelKey } from './utils';

export const TEXT_MODEL_TIMEOUT_MS = 120000;
export const IMAGE_MODEL_TIMEOUT_MS = 120000;

export const withTimeout = async <T>(
  promise: Promise<T>,
  ms: number,
  errorMessage: string
): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(errorMessage)), ms);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};

interface IImageModelTestResult {
  status: 'success' | 'failed';
  error?: string;
  isImageModel: true;
  imageAbility?: IImageModelAbility;
}

interface ITestImageModelCapabilityParams {
  modelKey: string;
  provider: Required<LLMProvider>;
  onTest: (data: ITestLLMRo) => Promise<ITestLLMVo>;
}

export const testImageModelCapability = async ({
  modelKey,
  provider,
  onTest,
}: ITestImageModelCapabilityParams): Promise<IImageModelTestResult> => {
  try {
    const { type, name, apiKey, baseUrl, models } = provider;
    const { model } = parseModelKey(modelKey);

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

    if (!generationResult.success) {
      return {
        status: 'failed',
        error: generationResult.response || 'Image generation test failed',
        isImageModel: true,
      };
    }

    let imageToImage = supportsKnownImageInputForImageModel(type, model);
    if (!imageToImage) {
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
          'Timeout'
        );
        imageToImage = i2iResult.success;
      } catch {
        // Image-to-image support remains optional for unknown image models.
      }
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
};
