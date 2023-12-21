import type { IColumnMetaRo } from '@teable-group/core';
import { columnMetaRoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { RouteConfig } from '../zod-to-openapi';

export const VIEW_FIELD_COLUMNMETA = '/table/{tableId}/view/{viewId}/columnMeta';

export const SetFieldsViewRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_FIELD_COLUMNMETA,
  description: 'Update view fields column meta',
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

export const setViewColumnMeta = async (
  tableId: string,
  viewId: string,
  columnMetaRo: IColumnMetaRo
) => {
  return axios.put<void>(
    urlBuilder(VIEW_FIELD_COLUMNMETA, {
      tableId,
      viewId,
    }),
    columnMetaRo
  );
};
