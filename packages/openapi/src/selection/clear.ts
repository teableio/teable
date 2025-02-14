import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IRangesRo } from './range';
import { rangesRoSchema } from './range';

export const CLEAR_URL = '/table/{tableId}/selection/clear';

export const ClearRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: CLEAR_URL,
  summary: 'Clear selected range content',
  description: 'Remove all content from the selected table range',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: rangesRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Successful clean up',
    },
  },
  tags: ['selection'],
});

export const clear = async (tableId: string, clearRo: IRangesRo) => {
  return axios.patch<null>(
    urlBuilder(CLEAR_URL, {
      tableId,
    }),
    clearRo
  );
};
