import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IUpdateFieldRo } from '@teable-group/core';
import { updateFieldRoSchema } from '@teable-group/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import { planFieldVoSchema } from './plan-create';

export const PLAN_FIELD_UPDATE = '/table/{tableId}/field/{fieldId}/plan';

export const planFieldUpdateVoSchema = planFieldVoSchema
  .merge(z.object({ skip: z.undefined() }))
  .or(z.object({ skip: z.literal(true) }));

export type IPlanFieldUpdateVo = z.infer<typeof planFieldUpdateVoSchema>;

export const planFieldUpdateRoute: RouteConfig = registerRoute({
  method: 'patch',
  path: PLAN_FIELD_UPDATE,
  description: 'Generate calculation plan for updating the field',
  request: {
    params: z.object({
      tableId: z.string(),
      fieldId: z.string(),
    }),
    body: {
      content: {
        'application/json': {
          schema: updateFieldRoSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Returns the calculation plan for updating the field',
      content: {
        'application/json': {
          schema: planFieldUpdateVoSchema,
        },
      },
    },
  },
  tags: ['field'],
});

export const planFieldUpdate = async (
  tableId: string,
  fieldId: string,
  fieldRo: IUpdateFieldRo
) => {
  return axios.patch<IPlanFieldUpdateVo>(
    urlBuilder(PLAN_FIELD_UPDATE, {
      tableId,
      fieldId,
    }),
    fieldRo
  );
};
