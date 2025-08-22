import { z } from 'zod';
import { IdPrefix } from '../../../utils';
import { commonFieldAIConfig, FieldAIActionType } from './text';

export const multipleSelectFieldTagAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Tag),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type IMultipleSelectFieldTagAIConfig = z.infer<typeof multipleSelectFieldTagAIConfigSchema>;

export const multipleSelectFieldCustomizeAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Customization),
  prompt: z.string(),
  attachmentFieldIds: z.array(z.string().startsWith(IdPrefix.Field)).optional(),
  onlyAllowConfiguredOptions: z.boolean().optional(),
});

export type IMultipleSelectFieldCustomizeAIConfig = z.infer<
  typeof multipleSelectFieldCustomizeAIConfigSchema
>;

export const multipleSelectFieldAIConfigSchema = z.union([
  multipleSelectFieldTagAIConfigSchema.strict(),
  multipleSelectFieldCustomizeAIConfigSchema.strict(),
]);

export type IMultipleSelectFieldAIConfig = z.infer<typeof multipleSelectFieldAIConfigSchema>;
