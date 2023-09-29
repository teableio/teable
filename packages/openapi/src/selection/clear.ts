import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { cellSchema, copyRoSchema } from './copy';

export const CLEAR_URL = '/table/{tableId}/view/{viewId}/selection/clear';

export const clearRoSchema = z.object({
  ranges: z.array(cellSchema).openapi({
    description:
      'The parameter "ranges" is used to represent the coordinates of a selected range in a table. ',
    example: [
      [0, 0],
      [1, 1],
    ],
  }),
  type: copyRoSchema.shape.type,
});

export type ClearRo = z.infer<typeof clearRoSchema>;

export const ClearRoute: RouteConfig = registerRoute({
  method: 'post',
  path: CLEAR_URL,
  description: 'Clarify the constituency section',
  request: {
    params: z.object({
      teableId: z.string(),
      viewId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: clearRoSchema,
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

export const clear = async (tableId: string, viewId: string, clearRo: ClearRo) => {
  return axios.post<null>(
    urlBuilder(CLEAR_URL, {
      params: { tableId, viewId },
    }),
    clearRo
  );
};
