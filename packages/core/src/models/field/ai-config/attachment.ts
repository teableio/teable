import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { commonFieldAIConfig, FieldAIActionType } from './text';

export enum ImageQuality {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

// Resolution presets for multimodal LLMs (controls image quality via prompt)
// eslint-disable-next-line @typescript-eslint/naming-convention
export const IMAGE_RESOLUTIONS = ['1K', '2K', '4K'] as const;

export type IImageResolution = (typeof IMAGE_RESOLUTIONS)[number];

// Resolution to approximate pixel dimensions mapping (for prompt generation)
/* eslint-disable @typescript-eslint/naming-convention */
export const RESOLUTION_PIXEL_MAP: Record<IImageResolution, number> = {
  '1K': 1024,
  '2K': 2048,
  '4K': 4096,
};
/* eslint-enable @typescript-eslint/naming-convention */

// Common aspect ratios for image generation (for multimodal LLMs that use prompt-based control)
// eslint-disable-next-line @typescript-eslint/naming-convention
export const IMAGE_ASPECT_RATIOS = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '21:9',
  '2:3',
  '3:2',
] as const;

export type IImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

export const attachmentFieldAIConfigBaseSchema = commonFieldAIConfig.extend({
  n: z.number().min(1).max(10).optional(),
  size: z
    .string()
    .regex(/^\d+x\d+$/, { message: 'Size must be in "widthxheight" format, e.g., "1024x1024"' })
    .optional(),
  quality: z.enum(ImageQuality).optional(),
  // Aspect ratio for multimodal LLMs (Gemini, etc.) - injected into prompt
  aspectRatio: z
    .string()
    .regex(/^\d+:\d+$/, { message: 'Aspect ratio must be in "width:height" format, e.g., "16:9"' })
    .optional(),
  // Resolution for multimodal LLMs (1K, 2K, 4K) - injected into prompt
  resolution: z.enum(IMAGE_RESOLUTIONS).optional(),
});

export const attachmentFieldGenerateImageAIConfigSchema = attachmentFieldAIConfigBaseSchema.extend({
  type: z.literal(FieldAIActionType.ImageGeneration),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type IAttachmentFieldGenerateImageAIConfig = z.infer<
  typeof attachmentFieldGenerateImageAIConfigSchema
>;

export const attachmentFieldCustomizeAIConfigSchema = attachmentFieldAIConfigBaseSchema.extend({
  type: z.literal(FieldAIActionType.ImageCustomization),
  prompt: z.string(),
});

export type IAttachmentFieldCustomizeAIConfig = z.infer<
  typeof attachmentFieldCustomizeAIConfigSchema
>;

export const attachmentFieldAIConfigSchema = z.discriminatedUnion('type', [
  attachmentFieldGenerateImageAIConfigSchema,
  attachmentFieldCustomizeAIConfigSchema,
]);

export type IAttachmentFieldAIConfig = z.infer<typeof attachmentFieldAIConfigSchema>;
