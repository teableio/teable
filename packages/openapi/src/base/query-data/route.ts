import { CellFormat, fieldVoSchema } from '@teable/core';
import { z } from '../../zod';
import { baseQueryColumnTypeSchema, baseQuerySchema } from './types';

export const baseQuerySchemaRo = z.object({
  query: z.string().transform((value, ctx) => {
    if (value == null) {
      return value;
    }

    const parsingResult = baseQuerySchema.safeParse(JSON.parse(value));
    if (!parsingResult.success) {
      parsingResult.error.issues.forEach((issue) => {
        ctx.addIssue(issue);
      });
      return z.NEVER;
    }
    return parsingResult.data;
  }),
  cellFormat: z
    .nativeEnum(CellFormat, {
      errorMap: () => ({ message: 'Error cellFormat, You should set it to "json" or "text"' }),
    })
    .default(CellFormat.Text),
});

export type IBaseQuerySchemaRo = z.infer<typeof baseQuerySchemaRo>;

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
