import { z } from 'zod';
import { FieldType } from '../constant';
import { attachmentFieldAIConfigSchema } from './attachment';
import { multipleSelectFieldAIConfigSchema } from './multiple-select';
import { ratingFieldAIConfigSchema } from './rating';
import { singleSelectFieldAIConfigSchema } from './single-select';
import { textFieldAIConfigSchema } from './text';

export * from './text';
export * from './single-select';
export * from './multiple-select';
export * from './attachment';
export * from './rating';
export const fieldAIConfigSchema = z.union([
  textFieldAIConfigSchema,
  singleSelectFieldAIConfigSchema,
  multipleSelectFieldAIConfigSchema,
  attachmentFieldAIConfigSchema,
  ratingFieldAIConfigSchema,
]);

export type IFieldAIConfig = z.infer<typeof fieldAIConfigSchema>;

export const getAiConfigSchema = (type: FieldType) => {
  switch (type) {
    case FieldType.SingleLineText:
    case FieldType.LongText:
      return textFieldAIConfigSchema;
    case FieldType.SingleSelect:
      return singleSelectFieldAIConfigSchema;
    case FieldType.MultipleSelect:
      return multipleSelectFieldAIConfigSchema;
    case FieldType.Attachment:
      return attachmentFieldAIConfigSchema;
    case FieldType.Rating:
    case FieldType.Number:
      return ratingFieldAIConfigSchema;
    default:
      return z.undefined();
  }
};
