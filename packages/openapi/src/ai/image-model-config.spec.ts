import { describe, expect, it } from 'vitest';
import {
  getImageAspectRatioCandidates,
  getImageModelConfigByModelKey,
  getImageModelConfigByGatewayId,
  getImageModelIdFromModelKey,
  getImageSizeCandidates,
  getKnownImageModelAbility,
  isPromptControlledImageGenerationModel,
  supportsImageAspectRatioSelection,
  supportsImageInputForImageModel,
  supportsKnownImageInputForImageModel,
  supportsImageSizeSelection,
} from './image-model-config';

const GPT_IMAGE_2_MODEL_ID = 'openai/gpt-image-2';
const GPT_IMAGE_2_MODEL = 'gpt-image-2';
const GPT_IMAGE_15_MODEL = 'gpt-image-1.5';
const GPT_IMAGE_MINI_GATEWAY_MODEL_ID = 'openai/gpt-image-1-mini';
const GPT_IMAGE_2_MODEL_KEY = `aiGateway@${GPT_IMAGE_2_MODEL_ID}@teable`;
const GPT_IMAGE_2_DIRECT_MODEL_KEY = 'openai@gpt-image-2@OpenAI';
const IMAGE_GENERATION_TAG = 'image-generation';
const SIZE_1024 = '1024x1024';

describe('getImageModelConfigByGatewayId', () => {
  it('resolves provider-qualified gateway model IDs', () => {
    expect(getImageModelConfigByGatewayId('google/imagen-4.0-generate-001')?.provider).toBe(
      'google'
    );
    expect(getImageModelConfigByGatewayId('googleVertex/imagen-4.0-generate-001')?.provider).toBe(
      'googleVertex'
    );
  });

  it('resolves full model IDs that include provider-like path segments', () => {
    expect(getImageModelConfigByGatewayId('fal-ai/flux/dev')?.provider).toBe('fal');
  });

  it('does not guess when a bare model ID is shared by multiple providers', () => {
    expect(getImageModelConfigByGatewayId('imagen-4.0-generate-001')).toBeUndefined();
  });

  it('allows bare model ID fallback only when the catalog has a single matching model', () => {
    expect(getImageModelConfigByGatewayId('gpt-image-1')?.provider).toBe('openai');
  });

  it('resolves newer GPT image model family entries', () => {
    expect(getImageModelConfigByGatewayId(GPT_IMAGE_2_MODEL_ID)?.supportedSizes).toEqual([
      SIZE_1024,
      '1536x1024',
      '1024x1536',
      '2048x2048',
      '2048x1152',
      '3840x2160',
      '2160x3840',
    ]);
    expect(getImageModelConfigByGatewayId('openai/gpt-image-1.5')?.provider).toBe('openai');
    expect(getImageModelConfigByGatewayId('openai/gpt-image-1.5')?.supportedSizes).toEqual([
      SIZE_1024,
      '1536x1024',
      '1024x1536',
    ]);
    expect(getImageModelConfigByGatewayId('openai/gpt-image-1-mini')?.provider).toBe('openai');
  });

  it('derives finite preset candidates from range-only size models', () => {
    const config = getImageModelConfigByGatewayId('deepinfra/black-forest-labs/FLUX-1-dev');

    expect(config).toBeDefined();
    expect(getImageSizeCandidates(config!)).toEqual([
      '256x256',
      '512x512',
      '768x768',
      SIZE_1024,
      '1024x768',
      '1152x896',
      '1216x832',
      '1280x1024',
      '1344x768',
      '768x1344',
      '832x1216',
      '896x1152',
      '1024x1280',
      '1024x1344',
    ]);
  });

  it('filters range-backed size candidates against provider constraints', () => {
    const config = getImageModelConfigByGatewayId('amazonBedrock/amazon.nova-canvas-v1:0');

    expect(config).toBeDefined();
    expect(getImageSizeCandidates(config!)).not.toContain('256x256');
    expect(getImageSizeCandidates(config!)).toContain('1024x768');
    expect(getImageSizeCandidates(config!)).toContain('2048x1024');
    expect(getImageAspectRatioCandidates(config!)).toContain('1:4');
    expect(getImageAspectRatioCandidates(config!)).toContain('4:1');
  });

  it('uses explicit product aspect-ratio candidates for Gemini image language models', () => {
    const config = getImageModelConfigByGatewayId('google/gemini-3-pro-image');

    expect(config).toBeDefined();
    expect(config?.defaultAspectRatio).toBeUndefined();
    expect(getImageAspectRatioCandidates(config!)).toEqual([
      '1:1',
      '2:3',
      '3:2',
      '3:4',
      '4:3',
      '4:5',
      '5:4',
      '9:16',
      '16:9',
      '21:9',
    ]);
    expect(getImageAspectRatioCandidates(config!)).not.toContain('9:21');
    expect(getImageAspectRatioCandidates(config!)).not.toContain('2:1');
    expect(getImageAspectRatioCandidates(config!)).not.toContain('1:2');
  });

  it('resolves current AI Gateway image-generation catalog entries', () => {
    const gatewayModelIds = [
      'bfl/flux-2-flex',
      'bfl/flux-2-klein-4b',
      'bfl/flux-2-klein-9b',
      'bfl/flux-2-max',
      'bfl/flux-2-pro',
      'bytedance/seedream-4.0',
      'bytedance/seedream-4.5',
      'bytedance/seedream-5.0-lite',
      'google/gemini-3.1-flash-image-preview',
      'prodia/flux-fast-schnell',
      'recraft/recraft-v2',
      'recraft/recraft-v3',
      'recraft/recraft-v4',
      'recraft/recraft-v4-pro',
    ];

    for (const modelId of gatewayModelIds) {
      expect(getImageModelConfigByGatewayId(modelId), modelId).toBeDefined();
    }

    expect(getImageModelConfigByGatewayId('google/gemini-3.1-flash-image-preview')?.modelType).toBe(
      'language'
    );
    expect(getImageModelConfigByGatewayId('bfl/flux-2-pro')?.modelType).toBe('image');
    expect(getImageModelConfigByGatewayId('recraft/recraft-v4-pro')?.modelType).toBe('image');
  });
});

describe('getImageModelConfigByModelKey', () => {
  it('parses model keys consistently for gateway and direct providers', () => {
    expect(getImageModelIdFromModelKey(GPT_IMAGE_2_MODEL_KEY)).toBe(GPT_IMAGE_2_MODEL_ID);
    expect(getImageModelIdFromModelKey(GPT_IMAGE_2_DIRECT_MODEL_KEY)).toBe(GPT_IMAGE_2_MODEL_ID);
  });

  it('resolves direct provider model keys from the shared catalog', () => {
    const resolved = getImageModelConfigByModelKey(GPT_IMAGE_2_DIRECT_MODEL_KEY);

    expect(resolved?.config.provider).toBe('openai');
    expect(getImageSizeCandidates(resolved!.config)).toEqual([
      SIZE_1024,
      '1536x1024',
      '1024x1536',
      '2048x2048',
      '2048x1152',
      '3840x2160',
      '2160x3840',
    ]);
    expect(
      supportsImageInputForImageModel(resolved!.config, resolved!.modelId, resolved!.tags)
    ).toBe(true);
  });

  it('resolves gateway catalog models and keeps gateway tags available', () => {
    const resolved = getImageModelConfigByModelKey(GPT_IMAGE_2_MODEL_KEY, [
      {
        id: GPT_IMAGE_2_MODEL_ID,
        modelType: 'image',
        tags: [IMAGE_GENERATION_TAG, 'vision'],
      },
    ]);

    expect(resolved?.config.model).toBe(GPT_IMAGE_2_MODEL);
    expect(resolved?.tags).toEqual([IMAGE_GENERATION_TAG, 'vision']);
    expect(
      supportsImageInputForImageModel(resolved!.config, resolved!.modelId, resolved!.tags)
    ).toBe(true);
  });

  it('falls back to gateway language model metadata for prompt-controlled image generation', () => {
    const resolved = getImageModelConfigByModelKey('aiGateway@google/gemini-future-image@teable', [
      {
        id: 'google/gemini-future-image',
        modelType: 'language',
        tags: [IMAGE_GENERATION_TAG],
      },
    ]);

    expect(resolved?.config.modelType).toBe('language');
    expect(isPromptControlledImageGenerationModel(resolved!.config)).toBe(true);
    expect(supportsImageSizeSelection(resolved!.config)).toBe(false);
    expect(supportsImageAspectRatioSelection(resolved!.config)).toBe(true);
  });

  it('falls back to gateway image model metadata with shared default size candidates', () => {
    const resolved = getImageModelConfigByModelKey('aiGateway@custom/new-image-model@teable', [
      {
        id: 'custom/new-image-model',
        modelType: 'image',
      },
    ]);

    expect(resolved?.config.modelType).toBe('image');
    expect(supportsImageSizeSelection(resolved!.config)).toBe(true);
    expect(getImageSizeCandidates(resolved!.config)).toContain(SIZE_1024);
  });
});

describe('supportsKnownImageInputForImageModel', () => {
  it('uses the catalog for known direct and gateway image models', () => {
    expect(supportsKnownImageInputForImageModel('openai', GPT_IMAGE_2_MODEL)).toBe(true);
    expect(supportsKnownImageInputForImageModel('openai', GPT_IMAGE_15_MODEL)).toBe(true);
    expect(supportsKnownImageInputForImageModel('aiGateway', GPT_IMAGE_MINI_GATEWAY_MODEL_ID)).toBe(
      true
    );
  });

  it('does not infer BYOK providers from bare model names', () => {
    expect(supportsKnownImageInputForImageModel('openRouter', GPT_IMAGE_2_MODEL)).toBe(false);
    expect(supportsKnownImageInputForImageModel('openaiCompatible', GPT_IMAGE_2_MODEL)).toBe(false);
  });
});

describe('getKnownImageModelAbility', () => {
  it('derives image generation ability from known catalog image models', () => {
    expect(getKnownImageModelAbility('openai', GPT_IMAGE_2_MODEL)).toEqual({
      generation: true,
      imageToImage: true,
    });
    expect(getKnownImageModelAbility('openai', 'dall-e-3')).toEqual({
      generation: true,
      imageToImage: false,
    });
  });

  it('does not infer custom BYOK provider abilities from bare model names', () => {
    expect(getKnownImageModelAbility('openRouter', GPT_IMAGE_2_MODEL)).toBeUndefined();
    expect(getKnownImageModelAbility('openaiCompatible', GPT_IMAGE_2_MODEL)).toBeUndefined();
  });
});
