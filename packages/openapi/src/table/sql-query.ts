import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const sqlQuerySchema = z.object({
  viewId: z.string(),
  sql: z.string(),
});

export type ISqlQuerySchema = z.infer<typeof sqlQuerySchema>;

export const TABLE_SQL_QUERY = '/base/{baseId}/table/{tableId}/sql-query';

export const TableSqlQueryRoute: RouteConfig = registerRoute({
  method: 'post',
  path: TABLE_SQL_QUERY,
  description: 'Query a table by raw sql',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    query: sqlQuerySchema,
  },
  responses: {
    200: {
      description: 'Returns sql query result data.',
    },
  },
  tags: ['table'],
});

export const tableSqlQuery = async (baseId: string, tableId: string, query: ISqlQuerySchema) => {
  return axios.post<unknown[]>(
    urlBuilder(TABLE_SQL_QUERY, {
      baseId,
      tableId,
    }),
    undefined,
    {
      params: query,
    }
  );
};
