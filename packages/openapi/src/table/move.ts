import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { tableVoSchema } from './create';

export const MOVE_TABLE = '/base/{baseId}/table/{tableId}/move';

export const moveTableRoSchema = z.object({
  baseId: z.string(),
});

export type IMoveTableRo = z.infer<typeof moveTableRoSchema>;

export const MoveTableRoute: RouteConfig = registerRoute({
  method: 'post',
  path: MOVE_TABLE,
  summary: 'Get table details',
  description:
    'Retrieve detailed information about a specific table, including its schema, name, and configuration.',
  request: {
    params: z.object({
      baseId: z.string(),
      tableId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns data about a table.',
      content: {
        'application/json': {
          schema: tableVoSchema,
        },
      },
    },
  },
  tags: ['table'],
});

export const moveTable = async (baseId: string, tableId: string, moveTableRo: IMoveTableRo) => {
  return axios.post<{ baseId: string; tableId: string }>(
    urlBuilder(MOVE_TABLE, {
      baseId,
      tableId,
    }),
    moveTableRo
  );
};
