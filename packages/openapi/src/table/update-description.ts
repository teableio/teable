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
  description: 'Update table description',
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
      description: 'Successfully update.',
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
