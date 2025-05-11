import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { commonFieldAIConfig, FieldAIActionType } from './text';

export const ratingFieldRatingAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Rating),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type IRatingFieldRatingAIConfig = z.infer<typeof ratingFieldRatingAIConfigSchema>;

export const ratingFieldAIConfigSchema = ratingFieldRatingAIConfigSchema;

export type IRatingFieldAIConfig = z.infer<typeof ratingFieldAIConfigSchema>;
