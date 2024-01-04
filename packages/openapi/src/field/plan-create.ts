import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldRo } from '@teable-group/core';
import { fieldRoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { graphVoSchema } from '../table/get-cell-graph';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';

export const PLAN_FIELD_CREATE = '/table/{tableId}/field/plan';

export const planFieldVoSchema = z.object({
  isAsync: z.boolean(),
  graph: graphVoSchema,
  updateCellCount: z.number(),
  totalCellCount: z.number(),
});

export type IPlanFieldVo = z.infer<typeof planFieldVoSchema>;

export const planFieldCreateRoute: RouteConfig = registerRoute({
  method: 'post',
  path: PLAN_FIELD_CREATE,
  description: 'Generate calculation plan for creating the field',
  request: {
    params: z.object({
      tableId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: fieldRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns the calculation plan for creating the field',
      content: {
        'application/json': {
          schema: planFieldVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export const planFieldCreate = async (tableId: string, fieldRo: IFieldRo) => {
  return axios.post<IPlanFieldVo>(urlBuilder(PLAN_FIELD_CREATE, { tableId }), fieldRo);
};
