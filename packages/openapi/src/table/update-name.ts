import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const TABLE_NAME = '/base/{baseId}/table/{tableId}/name';

export const tableNameRoSchema = z.object({
  name: z.string(),
});

export type ITableNameRo = z.infer<typeof tableNameRoSchema>;

export const updateTableNameRoute: RouteConfig = registerRoute({
  method: 'put',
  path: TABLE_NAME,
  description: 'Update table name',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: tableNameRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update.',
    },
  },
  tags: ['table'],
});

export const updateTableName = async (baseId: string, tableId: string, data: ITableNameRo) => {
  return axios.put<void>(
    urlBuilder(TABLE_NAME, {
      baseId,
      tableId,
    }),
    data
  );
};
