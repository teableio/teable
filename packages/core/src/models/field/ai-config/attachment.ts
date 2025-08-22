import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { commonFieldAIConfig, FieldAIActionType } from './text';

export enum ImageQuality {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export const attachmentFieldAIConfigBaseSchema = commonFieldAIConfig.extend({
  n: z.number().min(1).max(10).optional(),
  size: z
    .string()
    .regex(/^\d+x\d+$/, { message: 'Size must be in "widthxheight" format, e.g., "1024x1024"' })
    .optional(),
  quality: z.nativeEnum(ImageQuality).optional(),
});

export const attachmentFieldGenerateImageAIConfigSchema = attachmentFieldAIConfigBaseSchema.extend({
  type: z.literal(FieldAIActionType.ImageGeneration),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type IAttachmentFieldGenerateImageAIConfig = z.infer<
  typeof attachmentFieldGenerateImageAIConfigSchema
>;

export const attachmentFieldCustomizeAIConfigSchema = attachmentFieldAIConfigBaseSchema.extend({
  type: z.literal(FieldAIActionType.Customization),
  prompt: z.string(),
  attachmentFieldIds: z.array(z.string().startsWith(IdPrefix.Field)).optional(),
});

export type IAttachmentFieldCustomizeAIConfig = z.infer<
  typeof attachmentFieldCustomizeAIConfigSchema
>;

export const attachmentFieldAIConfigSchema = z.union([
  attachmentFieldGenerateImageAIConfigSchema.strict(),
  attachmentFieldCustomizeAIConfigSchema.strict(),
]);

export type IAttachmentFieldAIConfig = z.infer<typeof attachmentFieldAIConfigSchema>;
