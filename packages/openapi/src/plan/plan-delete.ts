import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { planFieldVoSchema } from './plan';

export const PLAN_FIELD_DELETE = '/table/{tableId}/field/{fieldId}/plan';

export const planFieldDeleteVoSchema = planFieldVoSchema.partial();

export type IPlanFieldDeleteVo = z.infer<typeof planFieldDeleteVoSchema>;

export const planFieldDeleteRoute: RouteConfig = registerRoute({
  method: 'delete',
  path: PLAN_FIELD_DELETE,
  description: 'Generate calculation plan for deleting the field',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
  },
  responses: {
    200: {
      description: 'Returns the calculation plan for deleting the field',
      content: {
        'application/json': {
          schema: planFieldDeleteVoSchema,
        },
      },
    },
  },
  tags: ['plan'],
});

export const planFieldDelete = async (tableId: string, fieldId: string) => {
  return axios.delete<IPlanFieldDeleteVo>(urlBuilder(PLAN_FIELD_DELETE, { tableId, fieldId }));
};
