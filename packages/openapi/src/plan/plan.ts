import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { graphVoSchema } from './get-cell-graph';

export const PLAN_FIELD = '/table/{tableId}/field/{fieldId}/plan';

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
