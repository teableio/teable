import { describe, expect, it } from 'vitest';
import { gatewayApiModelRawSchema, getImageModelTagsFromAbility } from './index';

const IMAGE_GENERATION_TAG = 'image-generation';

describe('setting index exports', () => {
  it('re-exports model ability helpers from the setting barrel', () => {
    expect(
      getImageModelTagsFromAbility(
        {
          generation: true,
          imageToImage: true,
        },
        undefined
      )
    ).toEqual([IMAGE_GENERATION_TAG, 'vision']);
  });

  it('accepts current AI Gateway image model providers', () => {
    expect(
      gatewayApiModelRawSchema.parse({
        id: 'prodia/flux-fast-schnell',
        type: 'image',
        owned_by: 'prodia',
        tags: [IMAGE_GENERATION_TAG],
      }).owned_by
    ).toBe('prodia');
    expect(
      gatewayApiModelRawSchema.parse({
        id: 'recraft/recraft-v4-pro',
        type: 'image',
        owned_by: 'recraft',
        tags: [IMAGE_GENERATION_TAG],
      }).owned_by
    ).toBe('recraft');
  });
});
