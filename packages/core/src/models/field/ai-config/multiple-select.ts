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
  onlyAllowConfiguredOptions: z.boolean().optional(),
});

export type IMultipleSelectFieldCustomizeAIConfig = z.infer<
  typeof multipleSelectFieldCustomizeAIConfigSchema
>;

export const multipleSelectFieldAIConfigSchema = z.discriminatedUnion('type', [
  multipleSelectFieldTagAIConfigSchema,
  multipleSelectFieldCustomizeAIConfigSchema,
]);

export type IMultipleSelectFieldAIConfig = z.infer<typeof multipleSelectFieldAIConfigSchema>;
