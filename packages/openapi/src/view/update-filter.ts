import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFilterRo } from '@teable/core';
import { filterRoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const VIEW_FILTER = '/table/{tableId}/view/{viewId}/filter';

export const UpdateViewFilterRoute: RouteConfig = registerRoute({
  method: 'put',
  path: VIEW_FILTER,
  description: 'Update view filter',
  request: {
    params: z.object({
      tableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        // TODO zod-to-openapi does not support z.lazy which use in filterSchema
        'application/json': {
          schema: filterRoSchema.openapi({
            type: 'object',
            example: {
              filter: {
                filterSet: [
                  {
                    isSymbol: false,
                    fieldId: 'fldxxxxxxxxxxxxxxxx',
                    value: 'value',
                    operator: 'is',
                  },
                ],
                conjunction: 'and',
              },
            },
          }),
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

export const updateViewFilter = async (tableId: string, viewId: string, filterRo: IFilterRo) => {
  return axios.put<void>(
    urlBuilder(VIEW_FILTER, {
      tableId,
      viewId,
    }),
    filterRo
  );
};
