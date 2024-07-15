import { filterSchema, orderSchema } from '@teable/core';
import { aggregationFieldSchema } from '../aggregation';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const BASE_SQL_QUERY = '/base/{baseId}/sql-query';

export enum JoinType {
  Inner = 'INNER JOIN',
  Left = 'LEFT JOIN',
  Right = 'RIGHT JOIN',
  Full = 'FULL JOIN',
}

export const joinTypeSchema = z.nativeEnum(JoinType);

export const joinSchema = z.object({
  type: joinTypeSchema,
  table: z.string(),
  on: z.array(z.string(), z.string()).length(2),
});

export const fieldTypeSchema = z.enum(['context', 'field']);

export const orderBySchema = z.object({
  field: z.string(),
  type: fieldTypeSchema,
  order: orderSchema,
});

export const groupBySchema = z.array(
  z.object({
    field: z.string(),
    type: fieldTypeSchema,
  })
);

export const distinctSchema = z.array(
  z.object({
    field: z.string(),
    type: fieldTypeSchema,
  })
);

export const normalSqlQuery = z.object({
  groupBy: groupBySchema.optional(),
  orderBy: orderBySchema.optional(),
  where: filterSchema.optional(),
  join: z.array(joinSchema).optional(),
  limit: z.number().optional(),
  offset: z.number().optional(),
  aggregation: z.array(aggregationFieldSchema).optional(),
  distinct: z.array(z.string()).optional(),
});

export type INormalSqlQuery = z.infer<typeof normalSqlQuery>;

export type ISqlQuery = INormalSqlQuery & {
  from: string | ISqlQuery;
};

export const sqlQuerySchema: z.ZodType<ISqlQuery> = normalSqlQuery.extend({
  from: z.lazy(() => z.union([sqlQuerySchema, z.string()])),
});

export const sqlQuerySchemaRo = z.object({
  query: sqlQuerySchema,
});

export type ISqlQuerySchemaRo = z.infer<typeof sqlQuerySchemaRo>;

export const sqlQuerySchemaVo = z.array(z.record(z.string(), z.unknown())).optional();

export type ISqlQuerySchemaVo = z.infer<typeof sqlQuerySchemaVo>;

export const sqlQueryRoute = registerRoute({
  path: BASE_SQL_QUERY,
  method: 'get',
  description: 'Get sql query result',
  request: {
    params: z.object({
      baseId: z.string(),
    }),
    query: sqlQuerySchemaRo,
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
});

export const sqlQuery = (baseId: string, query: ISqlQuery) => {
  return axios.get<ISqlQuerySchemaVo>(urlBuilder(BASE_SQL_QUERY, { baseId }), {
    params: { query },
  });
};
