import { z } from 'zod';
import { IdPrefix } from '../../../utils';

export enum FieldAIActionType {
  Summary = 'summary',
  Translation = 'translation',
  Improvement = 'improvement',
  Extraction = 'extraction',
  Classification = 'classification',
  Tag = 'tag',
  Customization = 'customization',
  ImageGeneration = 'imageGeneration',
  Rating = 'rating',
}

export const commonFieldAIConfig = z.object({
  modelKey: z.string(),
  isAutoFill: z.boolean().nullable().optional(),
  attachPrompt: z.string().optional(),
});

export type ICommonFieldAIConfig = z.infer<typeof commonFieldAIConfig>;

export const textFieldExtractInfoAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Extraction),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type ITextFieldExtractInfoAIConfig = z.infer<typeof textFieldExtractInfoAIConfigSchema>;

export const textFieldSummarizeAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Summary),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type ITextFieldSummarizeAIConfig = z.infer<typeof textFieldSummarizeAIConfigSchema>;

export const textFieldTranslateAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Translation),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
  targetLanguage: z.string(),
});

export type ITextFieldTranslateAIConfig = z.infer<typeof textFieldTranslateAIConfigSchema>;

export const textFieldImproveTextAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Improvement),
  sourceFieldId: z.string().startsWith(IdPrefix.Field),
});

export type ITextFieldImproveTextAIConfig = z.infer<typeof textFieldImproveTextAIConfigSchema>;

export const textFieldCustomizeAIConfigSchema = commonFieldAIConfig.extend({
  type: z.literal(FieldAIActionType.Customization),
  attachmentFieldIds: z.array(z.string().startsWith(IdPrefix.Field)).optional(),
  prompt: z
    .string()
    .describe(
      `The prompt to use for the AI operation, use {fieldId} to reference the field in the table, example: "Summarize the content of {fieldId} into 100 words"\n` +
        `But if your reference field is attachment, do not reference it here, just put it in attachmentFieldIds the AI will known it`
    ),
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
