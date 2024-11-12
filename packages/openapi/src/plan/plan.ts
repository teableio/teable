import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLAN_FIELD = '/table/{tableId}/field/{fieldId}/plan';

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

export const planFieldVoSchema = z.object({
  estimateTime: z.number(),
  graph: graphVoSchema,
  updateCellCount: z.number(),
});

export type IPlanFieldVo = z.infer<typeof planFieldVoSchema>;

export const planFieldRoute: RouteConfig = registerRoute({
  method: 'get',
  path: PLAN_FIELD,
  description: 'Generate calculation plan for the field',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the calculation plan for the field',
      content: {
        'application/json': {
          schema: planFieldVoSchema,
        },
      },
    },
  },
  tags: ['plan'],
});

export const planField = async (tableId: string, fieldId: string) => {
  return axios.get<IPlanFieldVo>(
    urlBuilder(PLAN_FIELD, {
      tableId,
      fieldId,
    })
  );
};
