import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { commonFieldAIConfig, FieldAIActionType } from './text';

export const dateFieldExtractionAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Extraction),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type IDateFieldExtractionAIConfig = z.infer<typeof dateFieldExtractionAIConfigSchema>;

export const dateFieldCustomizeAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Customization),
  attachmentFieldIds: z.array(z.string().startsWith(IdPrefix.Field)).optional(),
  prompt: z.string(),
});

export type IDateFieldCustomizeAIConfig = z.infer<typeof dateFieldCustomizeAIConfigSchema>;

export const dateFieldAIConfigSchema = z.union([
  dateFieldExtractionAIConfigSchema.strict(),
  dateFieldCustomizeAIConfigSchema.strict(),
]);

export type IDateFieldAIConfig = z.infer<typeof dateFieldAIConfigSchema>;
