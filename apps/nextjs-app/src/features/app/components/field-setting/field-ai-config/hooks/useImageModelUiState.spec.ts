import { ImageQuality } from '@teable/core';
import type { IAttachmentFieldGenerateImageAIConfig } from '@teable/core';
import { renderHook } from '@testing-library/react';
import { useImageModelUiState } from './useImageModelUiState';

const gptImage2ModelKey = 'aiGateway@openai/gpt-image-2@teable';
const gatewayModels = [
  { id: 'openai/gpt-image-2', modelType: 'image', tags: ['image-generation'] },
] as const;

describe('useImageModelUiState', () => {
  it('uses Auto for new GPT Image 2 configs without an explicit size', () => {
    const { result } = renderHook(() => useImageModelUiState(gptImage2ModelKey, gatewayModels));

    expect(result.current.currentSize).toBe('');
    expect(result.current.imageModelConfig?.defaultSize).toBeUndefined();
    expect(result.current.imageModelConfig?.supportsAutoSize).toBe(true);
    expect(result.current.currentQuality).toBe(ImageQuality.Medium);
  });

  it('preserves an existing explicit GPT Image 2 size', () => {
    const aiConfig = {
      type: 'ImageGeneration',
      sourceFieldId: 'fld1234567890',
      size: '1536x1024',
    } as unknown as IAttachmentFieldGenerateImageAIConfig;

    const { result } = renderHook(() =>
      useImageModelUiState(gptImage2ModelKey, gatewayModels, aiConfig)
    );

    expect(result.current.currentSize).toBe('1536x1024');
    expect(result.current.imageSizeValues).toContain('2048x1536');
  });
});
