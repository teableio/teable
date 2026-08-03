import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const TABLE_DESCRIPTION = '/base/{baseId}/table/{tableId}/description';

export const tableDescriptionRoSchema = z.object({
  description: z.string().nullable(),
});

export type ITableDescriptionRo = z.infer<typeof tableDescriptionRoSchema>;

export const updateTableDescriptionRoute: RouteConfig = registerRoute({
  method: 'put',
  path: TABLE_DESCRIPTION,
  summary: 'Update table description',
  description:
    'Update or remove the description of a table. Set to null to remove the description.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: tableDescriptionRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Table description successfully updated.',
    },
  },
  tags: ['table'],
});

export const updateTableDescription = async (
  baseId: string,
  tableId: string,
  data: ITableDescriptionRo
) => {
  return axios.put<void>(
    urlBuilder(TABLE_DESCRIPTION, {
      baseId,
      tableId,
    }),
    data
  );
};
