import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const GET_CELL_GRAPH_URL = '/base/{baseId}/table/{tableId}/graph';

export const getGraphRoSchema = z.object({
  cell: z
    .tuple([z.string(), z.string()])
    .openapi({ description: 'The cell id coord, [fieldId, recordId]' }),
});

export type IGetGraphRo = z.infer<typeof getGraphRoSchema>;

export const graphNodeSchema = z
  .object({
    id: z.string(),
    label: z.string().optional(),
    comboId: z.string().optional(),
  })
  .passthrough();

export type IGraphNode = z.infer<typeof graphNodeSchema>;

export const graphEdgeSchema = z
  .object({
    source: z.string(),
    target: z.string(),
    label: z.string().optional(),
  })
  .passthrough();

export type IGraphEdge = z.infer<typeof graphEdgeSchema>;

export const graphComboSchema = z
  .object({
    id: z.string(),
    label: z.string(),
  })
  .passthrough();

export type IGraphCombo = z.infer<typeof graphComboSchema>;

export const graphVoSchema = z
  .object({
    nodes: z.array(graphNodeSchema),
    edges: z.array(graphEdgeSchema),
    combos: z.array(graphComboSchema),
  })
  .optional();

export type IGraphVo = z.infer<typeof graphVoSchema>;

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
      content: {
        'application/json': {
          schema: graphVoSchema,
        },
      },
    },
  },
  tags: ['graph'],
});

export const getGraph = async ({
  baseId,
  tableId,
  cell,
}: {
  baseId: string;
  tableId: string;
  cell: IGetGraphRo['cell'];
}) => {
  return axios.post<IGraphVo>(
    urlBuilder(GET_CELL_GRAPH_URL, {
      tableId,
      baseId,
    }),
    { cell }
  );
};
