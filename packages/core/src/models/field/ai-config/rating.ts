import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { commonFieldAIConfig, FieldAIActionType } from './text';

export const ratingFieldRatingAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Rating),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type IRatingFieldRatingAIConfig = z.infer<typeof ratingFieldRatingAIConfigSchema>;

export const ratingFieldCustomizeAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Customization),
  attachmentFieldIds: z.array(z.string().startsWith(IdPrefix.Field)).optional(),
  prompt: z.string(),
});

export type IRatingFieldCustomizeAIConfig = z.infer<typeof ratingFieldCustomizeAIConfigSchema>;

export const ratingFieldAIConfigSchema = z.union([
  ratingFieldRatingAIConfigSchema.strict(),
  ratingFieldCustomizeAIConfigSchema.strict(),
]);

export type IRatingFieldAIConfig = z.infer<typeof ratingFieldAIConfigSchema>;
