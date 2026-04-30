import { describe, expect, it } from 'vitest';
import { getImageModelTagsFromAbility } from './model-ability';

const IMAGE_GENERATION_TAG = 'image-generation';
const VISION_TAG = 'vision';

describe('getImageModelTagsFromAbility', () => {
  it('derives persisted image capability tags from image test results', () => {
    expect(
      getImageModelTagsFromAbility(
        {
          generation: true,
          imageToImage: true,
        },
        ['tool-use']
      )
    ).toEqual(['tool-use', IMAGE_GENERATION_TAG, VISION_TAG]);
  });

  it('removes stale image-to-image tags when the latest result does not support it', () => {
    expect(
      getImageModelTagsFromAbility(
        {
          generation: true,
          imageToImage: false,
        },
        [IMAGE_GENERATION_TAG, VISION_TAG]
      )
    ).toEqual([IMAGE_GENERATION_TAG]);
  });
});
