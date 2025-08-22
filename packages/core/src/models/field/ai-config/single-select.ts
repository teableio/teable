import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { commonFieldAIConfig, FieldAIActionType } from './text';

export const singleSelectFieldClassifyAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Classification),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type ISingleSelectFieldClassifyAIConfig = z.infer<
  typeof singleSelectFieldClassifyAIConfigSchema
>;

export const singleSelectFieldCustomizeAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Customization),
  prompt: z.string(),
  attachmentFieldIds: z.array(z.string().startsWith(IdPrefix.Field)).optional(),
  onlyAllowConfiguredOptions: z.boolean().optional(),
});

export type ISingleSelectFieldCustomizeAIConfig = z.infer<
  typeof singleSelectFieldCustomizeAIConfigSchema
>;

export const singleSelectFieldAIConfigSchema = z.union([
  singleSelectFieldClassifyAIConfigSchema.strict(),
  singleSelectFieldCustomizeAIConfigSchema.strict(),
]);

export type ISingleSelectFieldAIConfig = z.infer<typeof singleSelectFieldAIConfigSchema>;
