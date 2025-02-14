import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const DB_TABLE_NAME = '/base/{baseId}/table/{tableId}/db-table-name';

export const dbTableNameRoSchema = z.object({
  dbTableName: z
    .string()
    .min(1, { message: 'Table name cannot be empty' })
    .regex(/^[a-z_]\w{0,62}$/i, {
      message: 'Invalid name format',
    })
    .openapi({
      description:
        'table name in backend database. Limitation: 1-63 characters, start with letter or underscore, can only contain letters, numbers and underscore, case sensitive, cannot be duplicated with existing table name in the base.',
    }),
});

export type IDbTableNameRo = z.infer<typeof dbTableNameRoSchema>;

export const updateDbTableNameRoute: RouteConfig = registerRoute({
  method: 'put',
  path: DB_TABLE_NAME,
  summary: 'Update db table name',
  description:
    'Update the physical database table name. Must be 1-63 characters, start with letter or underscore, contain only letters, numbers and underscore, and be unique within the base.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: dbTableNameRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Database table name successfully updated.',
    },
  },
  tags: ['table'],
});

export const updateDbTableName = async (baseId: string, tableId: string, data: IDbTableNameRo) => {
  return axios.put<void>(
    urlBuilder(DB_TABLE_NAME, {
      baseId,
      tableId,
    }),
    data
  );
};
