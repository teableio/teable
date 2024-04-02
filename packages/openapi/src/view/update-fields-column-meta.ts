import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IColumnMetaRo } from '@teable/core';
import { columnMetaRoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_COLUMN_META = '/table/{tableId}/view/{viewId}/column-meta';

export const updateViewColumnMetaRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_COLUMN_META,
  description: 'Update view column meta',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: columnMetaRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successfully update.',
    },
  },
  tags: ['view'],
});

export const updateViewColumnMeta = async (
  tableId: string,
  viewId: string,
  columnMetaRo: IColumnMetaRo
) => {
  return axios.put<void>(
    urlBuilder(VIEW_COLUMN_META, {
      tableId,
      viewId,
    }),
    columnMetaRo
  );
};
