import { z } from 'zod';
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
