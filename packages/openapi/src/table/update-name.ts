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
  summary: 'Update table name',
  description:
    'Update the display name of a table. This will not affect the underlying database table name.',
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
      description: 'Table name successfully updated.',
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
