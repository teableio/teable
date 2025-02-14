import { CellFormat, fieldVoSchema } from '@teable/core';
import { axios } from '../../axios';
import { registerRoute, urlBuilder } from '../../utils';
import { z } from '../../zod';
import type { IBaseQuery } from './types';
import { baseQueryColumnTypeSchema, baseQuerySchema } from './types';

export const BASE_QUERY = '/base/{baseId}/query';

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

export const baseQueryRoute = registerRoute({
  path: BASE_QUERY,
  method: 'get',
  description: 'Get base query result',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    query: baseQuerySchemaRo,
  },
  responses: {
    200: {
      description: 'The sql query result',
      content: {
        'application/json': {
          schema: z.array(z.record(z.string(), z.unknown())),
        },
      },
    },
  },
  tags: ['base'],
});

export const baseQuery = (baseId: string, query: IBaseQuery, cellFormat?: CellFormat) => {
  return axios.get<IBaseQueryVo>(urlBuilder(BASE_QUERY, { baseId }), {
    params: { query: JSON.stringify(query), cellFormat },
  });
};
