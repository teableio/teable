/* eslint-disable sonarjs/no-duplicate-string */
import { getImageModelConfigByGatewayId } from '@teable/openapi';
import { sanitizeAttachmentAiConfigForModel } from './AttachmentFieldAiConfig';

describe('sanitizeAttachmentAiConfigForModel', () => {
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
