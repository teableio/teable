import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IGraphVo } from '@teable-group/core';
import { getGraphRoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_CELL_GRAPH_URL = '/base/{baseId}/table/{tableId}/graph';

export const GetCellGraphRoute: RouteConfig = registerRoute({
  method: 'post',
  path: GET_CELL_GRAPH_URL,
  description: 'Get cell references graph',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: getGraphRoSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'get cell references graph',
    },
  },
  tags: ['graph'],
});

export const getGraph = async ({
  baseId,
  tableId,
  viewId,
  cell,
}: {
  baseId: string;
  tableId: string;
  viewId?: string;
  cell: [number, number];
}) => {
  return axios.post<IGraphVo>(
    urlBuilder(GET_CELL_GRAPH_URL, {
      tableId,
      baseId,
    }),
    { cell, viewId }
  );
};
