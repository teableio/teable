import { z } from 'zod';
import { IdPrefix } from '../../../utils';

export enum FieldAIActionType {
  Summarize = 'summarize',
  Translate = 'translate',
  ImproveText = 'improveText',
  ExtractInfo = 'extractInfo',
  Classify = 'classify',
  Tag = 'tag',
  Customize = 'customize',
}

export const commonFieldAIConfig = z.object({
  modelKey: z.string(),
  isAutoFill: z.boolean().nullable().optional(),
  attachPrompt: z.string().optional(),
});

export type ICommonFieldAIConfig = z.infer<typeof commonFieldAIConfig>;

export const textFieldExtractInfoAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.ExtractInfo),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type ITextFieldExtractInfoAIConfig = z.infer<typeof textFieldExtractInfoAIConfigSchema>;

export const textFieldSummarizeAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Summarize),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type ITextFieldSummarizeAIConfig = z.infer<typeof textFieldSummarizeAIConfigSchema>;

export const textFieldTranslateAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Translate),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
  targetLanguage: z.string(),
});

export type ITextFieldTranslateAIConfig = z.infer<typeof textFieldTranslateAIConfigSchema>;

export const textFieldImproveTextAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.ImproveText),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type ITextFieldImproveTextAIConfig = z.infer<typeof textFieldImproveTextAIConfigSchema>;

export const textFieldCustomizeAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Customize),
  prompt: z.string(),
});

export type ITextFieldCustomizeAIConfig = z.infer<typeof textFieldCustomizeAIConfigSchema>;

export const textFieldAIConfigSchema = z.union([
  textFieldExtractInfoAIConfigSchema,
  textFieldSummarizeAIConfigSchema,
  textFieldTranslateAIConfigSchema,
  textFieldImproveTextAIConfigSchema,
  textFieldCustomizeAIConfigSchema,
]);

export type ITextFieldAIConfig = z.infer<typeof textFieldAIConfigSchema>;
