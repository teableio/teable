import { z } from 'zod';
import type { GatewayModelTag } from './gateway-model';

// Detailed ability support with URL and base64 variants
export const abilityDetailSchema = z.object({
  url: z.boolean().optional(),
  base64: z.boolean().optional(),
});

export type IAbilityDetail = z.infer<typeof abilityDetailSchema>;

// Model ability schema for test results
export const modelAbilitySchema = z.object({
  image: z.union([z.boolean(), abilityDetailSchema]).optional(), // vision/image input
  pdf: z.union([z.boolean(), abilityDetailSchema]).optional(), // PDF/file input
  webSearch: z.boolean().optional(),
  toolCall: z.boolean().optional(), // tool/function calling
  reasoning: z.boolean().optional(), // extended thinking/reasoning
  imageGeneration: z.boolean().optional(), // can generate images
});

export type IModelAbility = z.infer<typeof modelAbilitySchema>;

// Image model ability schema
export const imageModelAbilitySchema = z.object({
  generation: z.boolean().optional(), // can generate images from text
  imageToImage: z.boolean().optional(), // can generate images from image input
});

export type IImageModelAbility = z.infer<typeof imageModelAbilitySchema>;

const IMAGE_GENERATION_TAG: GatewayModelTag = 'image-generation';
const VISION_TAG: GatewayModelTag = 'vision';
const IMAGE_ABILITY_TAGS = new Set<GatewayModelTag>([IMAGE_GENERATION_TAG, VISION_TAG]);

export const getImageModelTagsFromAbility = (
  imageAbility: IImageModelAbility | undefined,
  currentTags: readonly GatewayModelTag[] | undefined
): GatewayModelTag[] | undefined => {
  if (!imageAbility) return currentTags ? [...currentTags] : undefined;

  const nextTags = (currentTags ?? []).filter((tag) => !IMAGE_ABILITY_TAGS.has(tag));
  if (imageAbility.generation) {
    nextTags.push(IMAGE_GENERATION_TAG);
  }
  if (imageAbility.imageToImage) {
    nextTags.push(VISION_TAG);
  }

  return nextTags.length ? nextTags : undefined;
};

// chatModelAbilitySchema is same as modelAbilitySchema, for backward compatibility
export const chatModelAbilitySchema = modelAbilitySchema;

export const chatModelAbilityType = chatModelAbilitySchema.keyof();

export type IChatModelAbilityType = z.infer<typeof chatModelAbilityType>;

export type IChatModelAbility = z.infer<typeof chatModelAbilitySchema>;
