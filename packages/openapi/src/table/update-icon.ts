import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const TABLE_ICON = '/base/{baseId}/table/{tableId}/icon';

export const tableIconRoSchema = z.object({
  icon: z.string().emoji(),
});

export type ITableIconRo = z.infer<typeof tableIconRoSchema>;

export const updateTableIconRoute: RouteConfig = registerRoute({
  method: 'put',
  path: TABLE_ICON,
  description: 'Update table icon',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: tableIconRoSchema,
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

export const updateTableIcon = async (baseId: string, tableId: string, data: ITableIconRo) => {
  return axios.put<void>(
    urlBuilder(TABLE_ICON, {
      baseId,
      tableId,
    }),
    data
  );
};
