import { ImageQuality } from '@teable/core';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_MODEL_CONFIGS,
  getImageAspectRatioCandidates,
  getImageModelConfigByModelKey,
  getImageModelConfigByGatewayId,
  getImageModelIdFromModelKey,
  getImageSizeCandidates,
  getImageQualityCandidates,
  getImageResolutionCandidates,
  getSupportedImageResolution,
  getKnownImageModelAbility,
  isPromptControlledImageGenerationModel,
  supportsImageAspectRatioSelection,
  supportsImageInputForImageModel,
  supportsKnownImageInputForImageModel,
  supportsImageSizeSelection,
} from './image-model-config';
import {
  getOpenAIGptImage2SizeMeta,
  OPENAI_GPT_IMAGE_2_PRESETS,
  OPENAI_GPT_IMAGE_2_SIZE_META,
  OPENAI_GPT_IMAGE_2_SIZES,
  imageSizeSchema,
} from './image-model-dimensions';

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
      '1024x768',
      '768x1024',
      '1024x672',
      '672x1024',
      '1280x720',
      '720x1280',
      '2048x1152',
      '1152x2048',
      '2048x2048',
      '2048x1536',
      '1536x2048',
      '2048x1360',
      '1360x2048',
      '2880x2880',
      '3504x2336',
      '2336x3504',
      '3264x2448',
      '2448x3264',
      '3840x2160',
      '2160x3840',
    ]);
    expect(getImageModelConfigByGatewayId(GPT_IMAGE_2_MODEL_ID)?.defaultSize).toBeUndefined();
    expect(getImageModelConfigByGatewayId(GPT_IMAGE_2_MODEL_ID)?.supportsAutoSize).toBe(true);
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
      'openai/gpt-image-2.5-flare',
      'openai/gpt-image-2.5-sunburst',
      'google/gemini-3.1-flash-image',
      'google/gemini-3.1-flash-lite-image',
      'bytedance/seedream-5.0-pro',
      'recraft/recraft-v4.1',
      'recraft/recraft-v4.1-pro',
      'recraft/recraft-v4.1-utility',
      'recraft/recraft-v4.1-utility-pro',
      'meta/muse-image-1.0',
      'spacexai/grok-imagine-image',
      'spacexai/grok-imagine-image-2.0',
      'quiverai/arrow-1.1',
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

describe('image model parameter contracts', () => {
  it('keeps all catalog size presets in the shared size schema', () => {
    for (const config of IMAGE_MODEL_CONFIGS) {
      for (const size of config.supportedSizes ?? []) {
        expect(imageSizeSchema.safeParse(size).success, `${config.model}: ${size}`).toBe(true);
      }
      if (config.defaultSize) {
        expect(config.supportedSizes, config.model).toContain(config.defaultSize);
      }
    }
  });

  it.each(['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'])(
    'retains the existing product size and quality options for %s',
    (model) => {
      const config = getImageModelConfigByGatewayId(`openai/${model}`)!;
      expect(config.defaultSize).toBeUndefined();
      expect(config.supportsAutoSize).toBe(true);
      expect(getImageSizeCandidates(config)).toContain('3840x2160');
      expect(getImageSizeCandidates(config)).not.toContain('256x256');
      expect(getImageQualityCandidates(config)).toEqual([
        ImageQuality.Low,
        ImageQuality.Medium,
        ImageQuality.High,
      ]);
    }
  );

  it.each(['recraft-v4', 'recraft-v4.1', 'recraft-v4.1-utility'])(
    'uses V4 size presets for %s and doubles dimensions for its Pro variant',
    (model) => {
      const standard = getImageModelConfigByGatewayId(`recraft/${model}`)!;
      const pro = getImageModelConfigByGatewayId(`recraft/${model}-pro`)!;
      expect(standard.defaultSize).toBe(SIZE_1024);
      expect(standard.supportedSizes).toContain('1344x768');
      expect(standard.supportedSizes).not.toContain('1820x1024');
      expect(pro.defaultSize).toBe('2048x2048');
      expect(pro.supportedSizes).toEqual(
        standard.supportedSizes!.map((size) => {
          const [width, height] = size.split('x').map(Number);
          return `${width * 2}x${height * 2}`;
        })
      );
      expect(getImageModelConfigByGatewayId('recraft/recraft-v3')?.supportedSizes).toContain(
        '1820x1024'
      );
    }
  );

  it('limits Gemini Lite and Gemini 2.5 to 1K while keeping higher-resolution models available', () => {
    for (const model of ['gemini-3.1-flash-lite-image', 'gemini-2.5-flash-image']) {
      const config = getImageModelConfigByGatewayId(`google/${model}`)!;
      expect(getImageResolutionCandidates(config)).toEqual(['1K']);
      expect(getSupportedImageResolution(config, '4K')).toBeUndefined();
    }
    expect(
      getImageResolutionCandidates(getImageModelConfigByGatewayId('google/gemini-3.1-flash-image')!)
    ).toEqual(['1K', '2K', '4K']);
  });

  it('resolves SpaceXAI IDs using the direct xAI parameter contract', () => {
    const config = getImageModelConfigByGatewayId('spacexai/grok-imagine-image-2.0')!;
    expect(config).toBe(getImageModelConfigByGatewayId('xai/grok-imagine-image-2.0'));
    expect(config.supportedAspectRatios).toContain('5:2');
    expect(getImageResolutionCandidates(config)).toEqual(['1K', '2K']);
    expect(getImageQualityCandidates(config)).toEqual([ImageQuality.Low, ImageQuality.Medium]);
  });

  it('limits Seedream Pro to its 1K/2K presets and a single image per call', () => {
    const config = getImageModelConfigByGatewayId('bytedance/seedream-5.0-pro')!;
    expect(config.defaultSize).toBe(SIZE_1024);
    expect(config.supportedSizes).toContain('2816x1584');
    expect(config.supportedSizes).not.toContain('3840x2160');
    expect(config.maxImagesPerCall).toBe(1);
  });

  it.each(['meta/muse-image-1.0', 'quiverai/arrow-1.1'])(
    'does not invent pixel sizes or aspect ratios for %s',
    (modelId) => {
      const config = getImageModelConfigByGatewayId(modelId)!;
      expect(supportsImageSizeSelection(config)).toBe(false);
      expect(supportsImageAspectRatioSelection(config)).toBe(false);
      expect(getImageResolutionCandidates(config)).toEqual([]);
    }
  );

  it.each(['spacexai/grok-imagine-image-2.0', 'meta/muse-image-1.0', 'bytedance/seedream-5.0-pro'])(
    'enables reference image input for %s',
    (modelId) =>
      expect(
        supportsImageInputForImageModel(getImageModelConfigByGatewayId(modelId)!, modelId)
      ).toBe(true)
  );
});

describe('OPENAI_GPT_IMAGE_2_PRESETS', () => {
  it('derives supported sizes and size metadata from one preset table', () => {
    expect(OPENAI_GPT_IMAGE_2_SIZES).toEqual(OPENAI_GPT_IMAGE_2_PRESETS.map(({ size }) => size));

    for (const preset of OPENAI_GPT_IMAGE_2_PRESETS) {
      expect(OPENAI_GPT_IMAGE_2_SIZE_META[preset.size]).toEqual({
        ratio: preset.ratio,
        tier: preset.tier,
      });
      expect(getOpenAIGptImage2SizeMeta(preset.size)).toEqual({
        ratio: preset.ratio,
        tier: preset.tier,
      });
    }

    expect(getOpenAIGptImage2SizeMeta()).toBeUndefined();
    expect(getOpenAIGptImage2SizeMeta('1792x1024')).toBeUndefined();
  });

  it('keeps non-experimental presets within the GPT Image 2 size constraints', () => {
    const experimentalSizes = new Set(['3840x2160', '2160x3840']);

    for (const { size } of OPENAI_GPT_IMAGE_2_PRESETS) {
      if (experimentalSizes.has(size)) continue;

      const [width, height] = size.split('x').map(Number);
      const pixels = width * height;

      expect(width % 16, size).toBe(0);
      expect(height % 16, size).toBe(0);
      expect(Math.max(width, height), size).toBeLessThan(3840);
      expect(Math.max(width, height) / Math.min(width, height), size).toBeLessThanOrEqual(3);
      expect(pixels, size).toBeGreaterThanOrEqual(655_360);
      expect(pixels, size).toBeLessThanOrEqual(8_294_400);
    }
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
      '1024x768',
      '768x1024',
      '1024x672',
      '672x1024',
      '1280x720',
      '720x1280',
      '2048x1152',
      '1152x2048',
      '2048x2048',
      '2048x1536',
      '1536x2048',
      '2048x1360',
      '1360x2048',
      '2880x2880',
      '3504x2336',
      '2336x3504',
      '3264x2448',
      '2448x3264',
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
