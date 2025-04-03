import { z } from 'zod';
import { FieldType } from '../constant';
import { multipleSelectFieldAIConfigSchema } from './multiple-select';
import { singleSelectFieldAIConfigSchema } from './single-select';
import { textFieldAIConfigSchema } from './text';

export * from './text';
export * from './single-select';
export * from './multiple-select';

export const fieldAIConfigSchema = z.union([
  textFieldAIConfigSchema,
  singleSelectFieldAIConfigSchema,
  multipleSelectFieldAIConfigSchema,
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
    default:
      return z.undefined();
  }
};
