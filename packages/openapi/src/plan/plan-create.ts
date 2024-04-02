import type { RouteConfig } from '@asteasolutions/zod-to-openapi';
import type { IFieldRo } from '@teable/core';
import { createFieldRoSchema } from '@teable/core';
import { axios } from '../axios';
import { registerRoute, urlBuilder } from '../utils';
import { z } from '../zod';
import type { IPlanFieldVo } from './plan';
import { planFieldVoSchema } from './plan';

export const PLAN_FIELD_CREATE = '/table/{tableId}/field/plan';

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
          schema: createFieldRoSchema,
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
  tags: ['plan'],
});

export const planFieldCreate = async (tableId: string, fieldRo: IFieldRo) => {
  return axios.post<IPlanFieldVo>(urlBuilder(PLAN_FIELD_CREATE, { tableId }), fieldRo);
};
