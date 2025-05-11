import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { commonFieldAIConfig, FieldAIActionType } from './text';

export enum ImageQuality {
  Low = 'low',
  Medium = 'medium',
  High = 'high',
}

export const attachmentFieldGenerateImageAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.ImageGeneration),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
  n: z.number().min(1).max(10).optional(),
  size: z
    .string()
    .regex(/^\d+x\d+$/, { message: 'Size must be in "widthxheight" format, e.g., "1024x1024"' })
    .optional(),
  quality: z.nativeEnum(ImageQuality).optional(),
});

export type IAttachmentFieldGenerateImageAIConfig = z.infer<
  typeof attachmentFieldGenerateImageAIConfigSchema
>;

export const attachmentFieldAIConfigSchema = attachmentFieldGenerateImageAIConfigSchema;

export type IAttachmentFieldAIConfig = z.infer<typeof attachmentFieldAIConfigSchema>;
