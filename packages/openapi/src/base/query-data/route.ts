import { fieldVoSchema } from '@teable/core';
import { z } from '../../zod';
import { baseQueryColumnTypeSchema } from './types';

export const baseQueryColumnSchema = z.object({
  name: z.string(),
  column: z.string(),
  type: baseQueryColumnTypeSchema,
  fieldSource: fieldVoSchema.optional(),
});

export type IBaseQueryColumn = z.infer<typeof baseQueryColumnSchema>;

export const baseQuerySchemaVo = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  columns: z.array(baseQueryColumnSchema),
});

export type IBaseQueryVo = z.infer<typeof baseQuerySchemaVo>;
