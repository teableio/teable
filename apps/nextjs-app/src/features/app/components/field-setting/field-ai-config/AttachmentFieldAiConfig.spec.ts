/* eslint-disable sonarjs/no-duplicate-string */
import { getImageModelConfigByGatewayId } from '@teable/openapi';
import { sanitizeAttachmentAiConfigForModel } from './AttachmentFieldAiConfig';

describe('sanitizeAttachmentAiConfigForModel', () => {
  it('removes an unsupported resolution when switching to Gemini Lite', () => {
    const next = sanitizeAttachmentAiConfigForModel(
      { type: 'imageCustomization', prompt: 'Generate image', resolution: '4K' },
      { modelKey: 'aiGateway@google/gemini-3.1-flash-lite-image@teable' },
      getImageModelConfigByGatewayId('google/gemini-3.1-flash-lite-image')
    );
    expect(next).not.toHaveProperty('resolution');
  });

  it('preserves Grok resolution and removes unsupported quality', () => {
    const next = sanitizeAttachmentAiConfigForModel(
      { type: 'imageCustomization', prompt: 'Generate image', resolution: '2K', quality: 'high' },
      { modelKey: 'aiGateway@spacexai/grok-imagine-image-2.0@teable' },
      getImageModelConfigByGatewayId('spacexai/grok-imagine-image-2.0')
    );
    expect(next.resolution).toBe('2K');
    expect(next).not.toHaveProperty('quality');
  });

  it('removes prompt-controlled leftovers when switching to GPT Image 2', () => {
    const next = sanitizeAttachmentAiConfigForModel(
      {
        type: 'imageCustomization',
        modelKey: 'aiGateway@google/gemini-3-pro-image@teable',
        prompt: 'Generate image',
        aspectRatio: '3:2',
        resolution: '1K',
      },
      {
        modelKey: 'aiGateway@openai/gpt-image-2@teable',
        size: '1536x1024',
      },
      getImageModelConfigByGatewayId('openai/gpt-image-2')
    );

    expect(next).toEqual({
      type: 'imageCustomization',
      modelKey: 'aiGateway@openai/gpt-image-2@teable',
      prompt: 'Generate image',
      size: '1536x1024',
    });
  });

  it('removes size when switching to a prompt-controlled model', () => {
    const next = sanitizeAttachmentAiConfigForModel(
      {
        type: 'imageCustomization',
        modelKey: 'aiGateway@openai/gpt-image-2@teable',
        prompt: 'Generate image',
        size: '1536x1024',
      },
      {
        modelKey: 'aiGateway@google/gemini-3-pro-image@teable',
        aspectRatio: '16:9',
        resolution: '2K',
      },
      getImageModelConfigByGatewayId('google/gemini-3-pro-image')
    );

    expect(next).toEqual({
      type: 'imageCustomization',
      modelKey: 'aiGateway@google/gemini-3-pro-image@teable',
      prompt: 'Generate image',
      aspectRatio: '16:9',
      resolution: '2K',
    });
  });
});
