import { ImageQuality } from '@teable/core';
import type { IAttachmentFieldGenerateImageAIConfig } from '@teable/core';
import { renderHook } from '@testing-library/react';
import { useImageModelUiState } from './useImageModelUiState';

const gptImage2ModelKey = 'aiGateway@openai/gpt-image-2@teable';
const gatewayModels = [
  { id: 'openai/gpt-image-2', modelType: 'image', tags: ['image-generation'] },
] as const;

describe('useImageModelUiState', () => {
  it('offers only 1K for Gemini Lite and clears an existing unsupported resolution', () => {
    const aiConfig = { resolution: '4K' } as IAttachmentFieldGenerateImageAIConfig;
    const { result } = renderHook(() =>
      useImageModelUiState('aiGateway@google/gemini-3.1-flash-lite-image@teable', [], aiConfig)
    );
    expect(result.current.resolutionValues).toEqual(['1K']);
    expect(result.current.currentResolution).toBeUndefined();
    expect(result.current.getSettingsUpdates(false, aiConfig)).toHaveProperty(
      'resolution',
      undefined
    );
  });

  it('exposes resolution and supported quality options for Grok 2', () => {
    const { result } = renderHook(() =>
      useImageModelUiState('aiGateway@spacexai/grok-imagine-image-2.0@teable')
    );
    expect(result.current.supportsResolution).toBe(true);
    expect(result.current.resolutionValues).toEqual(['1K', '2K']);
    expect(result.current.qualityValues).toEqual([ImageQuality.Low, ImageQuality.Medium]);
    expect(result.current.supportsImageInput).toBe(true);
  });

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
